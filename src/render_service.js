import fs from "node:fs/promises";
import { chromium } from "playwright";
import { AssetServer } from "./asset_server.js";
import { createDiffArtifact } from "./diff.js";
import { HttpError } from "./errors.js";
import { createInspectArtifact } from "./inspect.js";
import { createPatchesArtifact } from "./patches.js";
import { JobQueue } from "./queue.js";
import { createStateCaptureArtifact } from "./states.js";

function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new HttpError(504, `${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function maybeWait(page, waitFor, timeoutMs) {
  if (typeof waitFor === "string") {
    if (["load", "domcontentloaded", "networkidle", "commit"].includes(waitFor)) {
      return;
    }
    throw new HttpError(400, `unsupported waitFor lifecycle: ${waitFor}`);
  }

  if (waitFor.selector) {
    await page.locator(waitFor.selector).waitFor({ timeout: timeoutMs });
  }
  if (waitFor.timeoutMs !== undefined) {
    await page.waitForTimeout(waitFor.timeoutMs);
  }
}

async function maybeTargetLocator(page, selector) {
  if (!selector) {
    return null;
  }
  const locator = page.locator(selector).first();
  await locator.waitFor();
  return locator;
}

async function ensureInspectLocator(page, locator) {
  if (locator) {
    return locator;
  }
  const bodyLocator = page.locator("body").first();
  await bodyLocator.waitFor();
  return bodyLocator;
}

function serializeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildViewportRequest(request, viewport) {
  return {
    ...request,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? request.viewport.deviceScaleFactor,
    },
  };
}

export class RenderService {
  constructor({
    host = "127.0.0.1",
    assetPort = 0,
    browserLaunchOptions = {},
    launchBrowser = (options) => chromium.launch(options),
    concurrency = 2,
    recycleEvery = 100,
  } = {}) {
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
      throw new Error("concurrency must be a positive integer");
    }
    if (!Number.isInteger(recycleEvery) || recycleEvery <= 0) {
      throw new Error("recycleEvery must be a positive integer");
    }

    this.host = host;
    this.assetServer = new AssetServer({ host, port: assetPort });
    this.browserLaunchOptions = browserLaunchOptions;
    this.launchBrowser = launchBrowser;
    this.queue = new JobQueue(concurrency);
    this.recycleEvery = recycleEvery;
    this.browser = null;
    this.browserGeneration = 0;
    this.completedJobs = 0;
    this.browserLaunchCount = 0;
    this.browserDisconnected = false;
    this.activeJobs = 0;
    this.pendingRecycle = false;
  }

  async start() {
    await this.assetServer.start();
    await this.#ensureBrowser();
  }

  async stop() {
    await this.#closeBrowser();
    await this.assetServer.stop();
  }

  stats() {
    return {
      browserLaunchCount: this.browserLaunchCount,
      browserGeneration: this.browserGeneration,
      completedJobs: this.completedJobs,
      browserConnected: Boolean(this.browser) && !this.browserDisconnected,
      assetBaseUrl: `http://${this.assetServer.host}:${this.assetServer.port}`,
      queue: this.queue.stats(),
    };
  }

  async render(request) {
    return this.queue.enqueue(async () => this.#renderNow(request));
  }

  async #ensureBrowser() {
    if (this.browser && this.browser.isConnected() && !this.browserDisconnected) {
      return this.browser;
    }

    this.browser = await this.launchBrowser({
      headless: true,
      ...this.browserLaunchOptions,
    });
    this.browserDisconnected = false;
    this.browser.on("disconnected", () => {
      this.browserDisconnected = true;
      this.browser = null;
    });
    this.browserGeneration += 1;
    this.browserLaunchCount += 1;
    return this.browser;
  }

  async #closeBrowser() {
    if (!this.browser) {
      return;
    }
    const browser = this.browser;
    this.browser = null;
    this.browserDisconnected = true;
    await browser.close().catch(() => {});
  }

  async #recycleBrowserIfNeeded() {
    if (this.pendingRecycle && this.activeJobs === 0) {
      await this.#closeBrowser();
      this.pendingRecycle = false;
    }
  }

  async #resolveNavigationTarget(request) {
    if (request.url) {
      return {
        kind: "goto",
        url: request.url,
        cleanup: async () => {},
      };
    }

    if (request.html) {
      return {
        kind: "content",
        html: request.html,
        cleanup: async () => {},
      };
    }

    if (request.htmlFile || request.entryFile) {
      const filePath = request.htmlFile ?? request.entryFile;
      await fs.access(filePath);
      const mount = this.assetServer.registerFile(filePath);
      return {
        kind: "goto",
        url: mount.url,
        cleanup: async () => {
          this.assetServer.unregisterMount(mount.mountId);
        },
      };
    }

    throw new HttpError(400, "missing render source");
  }

  async #runPageSession(browser, request, handler) {
    const contextStartMs = nowMs();
    const context = await browser.newContext({
      viewport: {
        width: request.viewport.width,
        height: request.viewport.height,
      },
      deviceScaleFactor: request.viewport.deviceScaleFactor,
      javaScriptEnabled: request.javascriptEnabled,
      extraHTTPHeaders: request.extraHeaders,
    });
    const contextMs = nowMs() - contextStartMs;

    const consoleMessages = [];
    const pageErrors = [];
    const requestFailures = [];

    try {
      const page = await context.newPage();
      page.on("console", (message) => {
        consoleMessages.push({
          type: message.type(),
          text: message.text(),
        });
      });
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      page.on("requestfailed", (failedRequest) => {
        requestFailures.push({
          url: failedRequest.url(),
          method: failedRequest.method(),
          failureText: failedRequest.failure()?.errorText ?? "unknown",
        });
      });

      const navigationTarget = await this.#resolveNavigationTarget(request);
      const gotoStartMs = nowMs();
      try {
        const waitUntil = typeof request.waitFor === "string" ? request.waitFor : "load";
        await withTimeout(
          (async () => {
            if (navigationTarget.kind === "goto") {
              await page.goto(navigationTarget.url, {
                waitUntil,
                timeout: request.timeoutMs,
              });
            } else {
              await page.setContent(navigationTarget.html, {
                waitUntil: waitUntil === "commit" ? "load" : waitUntil,
                timeout: request.timeoutMs,
              });
            }
            await maybeWait(page, request.waitFor, request.timeoutMs);
          })(),
          request.timeoutMs,
          "navigation",
        );
        const gotoMs = nowMs() - gotoStartMs;
        const renderStartMs = nowMs();
        const result = await handler({
          page,
          consoleMessages,
          pageErrors,
          requestFailures,
        });
        const renderMs = nowMs() - renderStartMs;
        return {
          ...result,
          consoleMessages,
          pageErrors,
          requestFailures,
          timing: {
            contextMs,
            gotoMs,
            renderMs,
          },
        };
      } finally {
        await navigationTarget.cleanup();
      }
    } finally {
      await context.close().catch(() => {});
    }
  }

  async #runSingleOutput(browser, request, reusedBrowser, browserGeneration, startMs) {
    const session = await this.#runPageSession(browser, request, async ({ page, consoleMessages, pageErrors, requestFailures }) => {
      const locator = await maybeTargetLocator(page, request.selector);

      if (request.output === "screenshot") {
        return {
          contentType: "image/png",
          bytes: locator
            ? await locator.screenshot({ type: "png" })
            : await page.screenshot({
                type: "png",
                fullPage: request.fullPage,
                clip: request.clip,
              }),
        };
      }

      if (request.output === "pdf") {
        await page.emulateMedia({ media: request.emulateMedia ?? "print" });
        return {
          contentType: "application/pdf",
          bytes: await page.pdf({ printBackground: true }),
        };
      }

      if (request.output === "html") {
        const text = await page.content();
        return {
          contentType: "text/html; charset=utf-8",
          text,
          bytes: Buffer.from(text, "utf8"),
        };
      }

      if (request.output === "inspect") {
        const inspectLocator = await ensureInspectLocator(page, locator);
        const inspectResult = await createInspectArtifact({
          page,
          targetLocator: inspectLocator,
          request,
          consoleMessages,
          pageErrors,
          requestFailures,
        });
        return {
          contentType: inspectResult.contentType,
          jsonBody: {
            analysis: inspectResult.analysis,
          },
        };
      }

      if (request.output === "patches") {
        const screenshotBytes = locator
          ? await locator.screenshot({ type: "png" })
          : await page.screenshot({
              type: "png",
              fullPage: request.fullPage,
              clip: request.clip,
            });
        const patchResult = await createPatchesArtifact({
          page,
          screenshotBytes,
          patches: request.patches,
        });
        return {
          contentType: patchResult.contentType,
          jsonBody: {
            patches: patchResult.patches,
          },
        };
      }

      if (request.output === "diff") {
        const screenshotBytes = locator
          ? await locator.screenshot({ type: "png" })
          : await page.screenshot({
              type: "png",
              fullPage: request.fullPage,
              clip: request.clip,
            });
        const baselineScreenshotBytes = await fs.readFile(request.diff.baseImagePath);
        const diffResult = await createDiffArtifact({
          page,
          currentScreenshotBytes: screenshotBytes,
          baselineScreenshotBytes,
          diff: request.diff,
        });
        return {
          contentType: diffResult.contentType,
          jsonBody: {
            diff: diffResult.diff,
          },
        };
      }

      if (request.output === "states") {
        const stateResult = await createStateCaptureArtifact({
          page,
          request,
          states: request.states,
        });
        return {
          contentType: stateResult.contentType,
          jsonBody: {
            states: stateResult.states,
          },
        };
      }

      throw new HttpError(400, `unsupported output: ${request.output}`);
    });

    const totalMs = nowMs() - startMs;
    const payload = session.jsonBody
      ? {
          ok: true,
          reusedBrowser,
          browserGeneration,
          contentType: session.contentType,
          consoleMessages: session.consoleMessages,
          pageErrors: session.pageErrors,
          requestFailures: session.requestFailures,
          timing: {
            ...session.timing,
            totalMs,
          },
          ...session.jsonBody,
        }
      : null;

    return {
      ok: true,
      reusedBrowser,
      browserGeneration,
      contentType: session.contentType,
      bytes: payload ? serializeJson(payload) : session.bytes,
      text: session.text,
      consoleMessages: session.consoleMessages,
      pageErrors: session.pageErrors,
      requestFailures: session.requestFailures,
      timing: {
        ...session.timing,
        totalMs,
      },
    };
  }

  async #runResponsiveOutput(browser, request, reusedBrowser, browserGeneration, startMs) {
    const items = [];
    const consoleMessages = [];
    const pageErrors = [];
    const requestFailures = [];
    let contextMs = 0;
    let gotoMs = 0;
    let renderMs = 0;

    for (const viewport of request.responsive.viewports) {
      const viewportRequest = buildViewportRequest(request, viewport);
      const session = await this.#runPageSession(browser, viewportRequest, async ({ page, consoleMessages: pageConsoleMessages, pageErrors: pageSessionErrors, requestFailures: pageRequestFailures }) => {
        const locator = await maybeTargetLocator(page, request.selector);
        const inspectLocator = await ensureInspectLocator(page, locator);
        const inspectResult = await createInspectArtifact({
          page,
          targetLocator: inspectLocator,
          request: viewportRequest,
          consoleMessages: pageConsoleMessages,
          pageErrors: pageSessionErrors,
          requestFailures: pageRequestFailures,
        });
        const screenshotBase64 = request.responsive.includeScreenshots
          ? (await page.screenshot({
              type: "png",
              fullPage: request.fullPage,
              clip: request.clip,
            })).toString("base64")
          : undefined;
        return {
          contentType: "application/json; charset=utf-8",
          jsonBody: {
            name: viewport.name,
            viewport: viewportRequest.viewport,
            analysis: inspectResult.analysis,
            screenshotBase64,
            consoleMessages: pageConsoleMessages,
            pageErrors: pageSessionErrors,
            requestFailures: pageRequestFailures,
          },
        };
      });

      contextMs += session.timing.contextMs;
      gotoMs += session.timing.gotoMs;
      renderMs += session.timing.renderMs;
      consoleMessages.push(...session.consoleMessages);
      pageErrors.push(...session.pageErrors);
      requestFailures.push(...session.requestFailures);
      items.push(session.jsonBody);
    }

    const totalMs = nowMs() - startMs;
    const worst = items.slice().sort((left, right) => left.analysis.summary.overallScore - right.analysis.summary.overallScore)[0];
    const payload = {
      ok: true,
      reusedBrowser,
      browserGeneration,
      contentType: "application/json; charset=utf-8",
      consoleMessages,
      pageErrors,
      requestFailures,
      timing: {
        contextMs,
        gotoMs,
        renderMs,
        totalMs,
      },
      responsive: {
        includeScreenshots: request.responsive.includeScreenshots,
        items,
        summary: {
          worstViewport: worst?.name,
          worstScore: worst?.analysis.summary.overallScore,
          primarySignals: worst?.analysis.summary.primarySignals ?? [],
        },
      },
    };

    return {
      ok: true,
      reusedBrowser,
      browserGeneration,
      contentType: payload.contentType,
      bytes: serializeJson(payload),
      consoleMessages,
      pageErrors,
      requestFailures,
      timing: payload.timing,
    };
  }

  async #renderNow(request) {
    await this.#recycleBrowserIfNeeded();

    const startMs = nowMs();
    this.activeJobs += 1;
    const reusedBrowser = Boolean(this.browser && this.browser.isConnected() && !this.browserDisconnected);
    const browser = await this.#ensureBrowser();
    const browserGeneration = this.browserGeneration;

    try {
      const result = request.output === "responsive"
        ? await this.#runResponsiveOutput(browser, request, reusedBrowser, browserGeneration, startMs)
        : await this.#runSingleOutput(browser, request, reusedBrowser, browserGeneration, startMs);

      this.completedJobs += 1;
      if (this.recycleEvery > 0 && this.completedJobs % this.recycleEvery === 0) {
        this.pendingRecycle = true;
      }
      return result;
    } finally {
      this.activeJobs -= 1;
      await this.#recycleBrowserIfNeeded();
    }
  }
}
