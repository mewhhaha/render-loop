import fs from "node:fs/promises";
import { chromium } from "playwright";
import { AssetServer } from "./asset_server.js";
import { HttpError } from "./errors.js";
import { JobQueue } from "./queue.js";

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

  async #renderNow(request) {
    await this.#recycleBrowserIfNeeded();

    const startMs = nowMs();
    this.activeJobs += 1;
    const reusedBrowser = Boolean(this.browser && this.browser.isConnected() && !this.browserDisconnected);
    const browser = await this.#ensureBrowser();
    const browserGeneration = this.browserGeneration;

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
        const locator = await maybeTargetLocator(page, request.selector);

        let bytes;
        let contentType;
        let text;
        if (request.output === "screenshot") {
          bytes = locator
            ? await locator.screenshot({ type: "png" })
            : await page.screenshot({
                type: "png",
                fullPage: request.fullPage,
                clip: request.clip,
              });
          contentType = "image/png";
        } else if (request.output === "pdf") {
          await page.emulateMedia({ media: request.emulateMedia ?? "print" });
          bytes = await page.pdf({ printBackground: true });
          contentType = "application/pdf";
        } else {
          text = await page.content();
          bytes = Buffer.from(text, "utf8");
          contentType = "text/html; charset=utf-8";
        }
        const renderMs = nowMs() - renderStartMs;

        this.completedJobs += 1;
        if (this.recycleEvery > 0 && this.completedJobs % this.recycleEvery === 0) {
          this.pendingRecycle = true;
        }

        return {
          ok: true,
          reusedBrowser,
          browserGeneration,
          contentType,
          bytes,
          text,
          consoleMessages,
          pageErrors,
          requestFailures,
          timing: {
            contextMs,
            gotoMs,
            renderMs,
            totalMs: nowMs() - startMs,
          },
        };
      } finally {
        await navigationTarget.cleanup();
      }
    } finally {
      await context.close().catch(() => {});
      this.activeJobs -= 1;
      await this.#recycleBrowserIfNeeded();
    }
  }
}
