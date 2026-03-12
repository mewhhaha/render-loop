import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { RenderService } from "../src/render_service.js";

function createBrowserFactory({ pageFactory } = {}) {
  let launchCount = 0;
  let closeCount = 0;
  let activePages = 0;
  const finishResolvers = [];

  function createPage() {
    const page = pageFactory
      ? pageFactory({ finishResolvers })
      : {
          on() {},
          async setContent() {},
          async waitForTimeout() {},
          async content() {
            activePages += 1;
            await new Promise((resolve) => {
              finishResolvers.push(() => {
                activePages -= 1;
                resolve();
              });
            });
            return "<html></html>";
          },
        };

    return {
      on() {},
      async setContent() {},
      async waitForTimeout() {},
      ...page,
    };
  }

  function createContext() {
    return {
      async newPage() {
        return createPage();
      },
      async close() {},
    };
  }

  function createBrowser() {
    let connected = true;
    let disconnectedHandler = () => {};
    return {
      isConnected() {
        return connected;
      },
      on(eventName, handler) {
        if (eventName === "disconnected") {
          disconnectedHandler = handler;
        }
      },
      async newContext() {
        return createContext();
      },
      async close() {
        connected = false;
        closeCount += 1;
        disconnectedHandler();
      },
    };
  }

  return {
    launchBrowser: async () => {
      launchCount += 1;
      return createBrowser();
    },
    getLaunchCount() {
      return launchCount;
    },
    getCloseCount() {
      return closeCount;
    },
    getActivePages() {
      return activePages;
    },
    releaseOne() {
      const resolve = finishResolvers.shift();
      if (resolve) {
        resolve();
      }
    },
  };
}

function createInspectPage({ domBySelector, imageMetrics, accessibilityBySelector }) {
  function createLocator(selector) {
    return {
      first() {
        return this;
      },
      async waitFor() {},
      async evaluate(_fn, input) {
        const selectedDom = domBySelector[selector] ?? domBySelector.body;
        return {
          ...selectedDom,
          spacing: {
            ...selectedDom.spacing,
            selector: input.selector,
          },
          layout: {
            ...selectedDom.layout,
            page: {
              ...selectedDom.layout.page,
              selector: input.selector,
              viewport: input.viewport,
            },
          },
        };
      },
      async ariaSnapshot() {
        return accessibilityBySelector[selector] ?? accessibilityBySelector.body ?? null;
      },
    };
  }

  return {
    on() {},
    async setContent() {},
    async waitForTimeout() {},
    locator(selector) {
      return createLocator(selector);
    },
    async screenshot() {
      return Buffer.from("inspect-image");
    },
    async evaluate() {
      return imageMetrics;
    },
  };
}

function createPatchesPage({ patchResult }) {
  return {
    on() {},
    async setContent() {},
    async waitForTimeout() {},
    async screenshot() {
      return Buffer.from("patch-source");
    },
    async evaluate(_fn, payload) {
      const include = payload.include ?? patchResult.items.map((item) => item.index);
      const selectedItems = patchResult.items.filter((item) => include.includes(item.index));
      return {
        ...patchResult,
        returned: selectedItems.length,
        items: selectedItems,
      };
    },
  };
}

function createDiffPage({ diffResult }) {
  return {
    on() {},
    async setContent() {},
    async waitForTimeout() {},
    async screenshot() {
      return Buffer.from("current-image");
    },
    async evaluate(_fn, payload) {
      assert.match(payload.currentDataUrl, /^data:image\/png;base64,/);
      assert.match(payload.baselineDataUrl, /^data:image\/png;base64,/);
      return diffResult;
    },
  };
}

function createStatesPage({ screenshots, actionLog }) {
  function createLocator(selector) {
    return {
      first() {
        return this;
      },
      async waitFor() {},
      async hover() {
        actionLog.push({ type: "hover", selector });
      },
      async focus() {
        actionLog.push({ type: "focus", selector });
      },
      async click() {
        actionLog.push({ type: "click", selector });
      },
    };
  }

  return {
    on() {},
    async setContent() {},
    async waitForTimeout(timeoutMs) {
      actionLog.push({ type: "wait", timeoutMs });
    },
    locator(selector) {
      return createLocator(selector);
    },
    async screenshot() {
      return Buffer.from(screenshots.shift() ?? "state-frame");
    },
  };
}

test("RenderService defers recycle until all in-flight jobs finish", async () => {
  const browserFactory = createBrowserFactory();
  const service = new RenderService({
    concurrency: 2,
    recycleEvery: 1,
    launchBrowser: browserFactory.launchBrowser,
  });

  service.assetServer.start = async () => {};
  service.assetServer.stop = async () => {};

  await service.start();

  const request = {
    html: "<html></html>",
    output: "html",
    viewport: { width: 100, height: 100, deviceScaleFactor: 1 },
    timeoutMs: 1_000,
    waitFor: "load",
    fullPage: true,
    javascriptEnabled: true,
  };

  const firstRender = service.render(request);
  const secondRender = service.render(request);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(browserFactory.getLaunchCount(), 1);
  assert.equal(browserFactory.getCloseCount(), 0);
  assert.equal(browserFactory.getActivePages(), 2);

  browserFactory.releaseOne();
  await firstRender;
  assert.equal(browserFactory.getCloseCount(), 0);

  browserFactory.releaseOne();
  await secondRender;
  assert.equal(browserFactory.getCloseCount(), 1);
});

test("RenderService returns inspect analysis JSON with aesthetic findings", async () => {
  const domBySelector = {
    body: {
      spacing: {
        selector: "body",
        gapCount: 4,
        gapMean: 52,
        gapStdDev: 34,
        smallGapCount: 1,
        largeGapCount: 1,
      },
      typography: {
        uniqueFontSizeCount: 8,
        fontSizes: [12, 14, 16, 18, 20, 24, 32, 48],
        bodyFontSize: 14,
        headingToBodyRatio: 3.43,
        averageLineHeightRatio: 1.12,
        headingLevelSkips: 1,
      },
      color: {
        distinctTextColors: 6,
        distinctSurfaceColors: 7,
        flatBackground: false,
      },
      layout: {
        page: {
          url: "https://example.com",
          title: "Aesthetic Fixture",
          selector: "body",
          viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        },
        visibleElementCount: 120,
        elementsPerViewport: 13.2,
        textDensity: 0.28,
        sectionCount: 5,
        headingCount: 3,
        longTextBlockCount: 3,
        heroSectionCount: 0,
        prominentCtaCount: 0,
        alignmentVariance: 92,
        centeredBlockRatio: 0.2,
        occupiedAreaRatio: 0.88,
      },
    },
    ".focus-panel": {
      spacing: {
        selector: ".focus-panel",
        gapCount: 2,
        gapMean: 28,
        gapStdDev: 4,
        smallGapCount: 0,
        largeGapCount: 0,
      },
      typography: {
        uniqueFontSizeCount: 3,
        fontSizes: [16, 24, 40],
        bodyFontSize: 16,
        headingToBodyRatio: 2.5,
        averageLineHeightRatio: 1.45,
        headingLevelSkips: 0,
      },
      color: {
        distinctTextColors: 2,
        distinctSurfaceColors: 2,
        flatBackground: false,
      },
      contrast: {
        sampledTextNodes: 4,
        aaFailures: 0,
        largeTextFailures: 0,
        worstRatio: 6.8,
        lowContrastSamples: [],
      },
      layout: {
        page: {
          url: "https://example.com",
          title: "Focused Panel",
          selector: ".focus-panel",
          viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        },
        visibleElementCount: 18,
        elementsPerViewport: 2.4,
        textDensity: 0.05,
        sectionCount: 3,
        headingCount: 2,
        longTextBlockCount: 0,
        heroSectionCount: 1,
        prominentCtaCount: 1,
        alignmentVariance: 18,
        centeredBlockRatio: 0.66,
        occupiedAreaRatio: 0.42,
      },
    },
  };
  const imageMetrics = {
    sampleWidth: 64,
    sampleHeight: 64,
    whitespaceRatio: 0.08,
    occupiedRatio: 0.92,
    edgeDensity: 0.24,
    dominantColorCount: 10,
    meanSaturation: 0.46,
    saturationSpread: 0.31,
    leftRightBalance: 0.61,
    topBottomBalance: 0.57,
  };
  const browserFactory = createBrowserFactory({
    pageFactory: () =>
      createInspectPage({
        domBySelector,
        imageMetrics,
        accessibilityBySelector: {
          body: "- main:\n  - heading \"Aesthetic Fixture\" [level=1]",
          ".focus-panel": "- region:\n  - heading \"Focused Panel\" [level=2]",
        },
      }),
  });
  const service = new RenderService({
    concurrency: 1,
    recycleEvery: 10,
    launchBrowser: browserFactory.launchBrowser,
  });

  service.assetServer.start = async () => {};
  service.assetServer.stop = async () => {};

  await service.start();

  const result = await service.render({
    html: "<html></html>",
    output: "inspect",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    timeoutMs: 1_000,
    waitFor: "load",
    fullPage: true,
    javascriptEnabled: true,
    selector: ".focus-panel",
  });

  assert.equal(result.contentType, "application/json; charset=utf-8");
  const payload = JSON.parse(result.bytes.toString("utf8"));
  assert.equal(payload.ok, true);
  assert.equal(payload.analysis.metrics.layout.page.selector, ".focus-panel");
  assert.equal(payload.analysis.accessibility.format, "aria-snapshot");
  assert.match(payload.analysis.accessibility.snapshot, /Focused Panel/);
  assert.equal(Array.isArray(payload.analysis.findings), true);
  assert.equal(payload.analysis.findings.some((finding) => finding.id === "visual-balance"), true);
  assert.equal(payload.analysis.findings.some((finding) => finding.id === "contrast-readability"), true);
  assert.equal(typeof payload.analysis.summary.overallScore, "number");
  assert.equal(payload.analysis.metrics.image.edgeDensity, imageMetrics.edgeDensity);
  assert.equal(payload.analysis.metrics.contrast.aaFailures, 0);
  assert.equal(payload.analysis.summary.primarySignals.length, 4);

  await service.stop();
});

test("RenderService returns screenshot patches as JSON", async () => {
  const patchResult = {
    imageWidth: 800,
    imageHeight: 1800,
    patchWidth: 400,
    patchHeight: 600,
    rows: 3,
    columns: 2,
    total: 6,
    overview: {
      width: 120,
      height: 240,
      contentType: "image/jpeg",
      bytesBase64: "OVERVIEW",
    },
    items: [
      {
        index: 0,
        row: 0,
        column: 0,
        x: 0,
        y: 0,
        width: 400,
        height: 600,
        contentType: "image/png",
        bytesBase64: "AAA",
      },
      {
        index: 3,
        row: 1,
        column: 1,
        x: 400,
        y: 600,
        width: 400,
        height: 600,
        contentType: "image/png",
        bytesBase64: "BBB",
      },
      {
        index: 4,
        row: 2,
        column: 0,
        x: 0,
        y: 1200,
        width: 400,
        height: 600,
        contentType: "image/png",
        bytesBase64: "CCC",
      },
    ],
  };
  const browserFactory = createBrowserFactory({
    pageFactory: () =>
      createPatchesPage({
        patchResult,
      }),
  });
  const service = new RenderService({
    concurrency: 1,
    recycleEvery: 10,
    launchBrowser: browserFactory.launchBrowser,
  });

  service.assetServer.start = async () => {};
  service.assetServer.stop = async () => {};

  await service.start();

  const result = await service.render({
    html: "<html></html>",
    output: "patches",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    timeoutMs: 1_000,
    waitFor: "load",
    fullPage: true,
    javascriptEnabled: true,
    patches: {
      width: 400,
      height: 600,
      include: [3, 4],
    },
  });

  assert.equal(result.contentType, "application/json; charset=utf-8");
  const payload = JSON.parse(result.bytes.toString("utf8"));
  assert.equal(payload.ok, true);
  assert.equal(payload.patches.imageHeight, 1800);
  assert.equal(payload.patches.total, 6);
  assert.equal(payload.patches.returned, 2);
  assert.equal(payload.patches.overview.contentType, "image/jpeg");
  assert.deepEqual(payload.patches.items.map((item) => item.index), [3, 4]);
  assert.equal(payload.patches.items[0].contentType, "image/png");

  await service.stop();
});

test("RenderService returns responsive inspect summaries across viewports", async () => {
  const browserFactory = createBrowserFactory({
    pageFactory: () =>
      createInspectPage({
        domBySelector: {
          body: {
            spacing: { gapCount: 2, gapMean: 24, gapStdDev: 6, smallGapCount: 0, largeGapCount: 0 },
            typography: {
              uniqueFontSizeCount: 4,
              fontSizes: [16, 18, 24, 40],
              bodyFontSize: 16,
              headingToBodyRatio: 2.5,
              averageLineHeightRatio: 1.45,
              headingLevelSkips: 0,
            },
            color: { distinctTextColors: 2, distinctSurfaceColors: 2, flatBackground: false },
            contrast: { sampledTextNodes: 5, aaFailures: 0, largeTextFailures: 0, worstRatio: 7.1, lowContrastSamples: [] },
            layout: {
              page: { url: "https://example.com", title: "Responsive Fixture" },
              visibleElementCount: 24,
              elementsPerViewport: 2.6,
              textDensity: 0.07,
              sectionCount: 3,
              headingCount: 2,
              longTextBlockCount: 0,
              heroSectionCount: 1,
              prominentCtaCount: 1,
              alignmentVariance: 18,
              centeredBlockRatio: 0.6,
              occupiedAreaRatio: 0.44,
            },
            aboveFold: {
              hasHeading: true,
              hasPrimaryAction: true,
              mediaCount: 1,
              headingCount: 1,
              actionCount: 1,
              coverageRatio: 0.52,
            },
          },
        },
        imageMetrics: {
          sampleWidth: 64,
          sampleHeight: 64,
          whitespaceRatio: 0.24,
          occupiedRatio: 0.76,
          edgeDensity: 0.08,
          dominantColorCount: 4,
          meanSaturation: 0.23,
          saturationSpread: 0.08,
          leftRightBalance: 0.94,
          topBottomBalance: 0.91,
        },
        accessibilityBySelector: {
          body: "- main:\n  - heading \"Responsive Fixture\" [level=1]",
        },
      }),
  });
  const service = new RenderService({
    concurrency: 1,
    recycleEvery: 10,
    launchBrowser: browserFactory.launchBrowser,
  });

  service.assetServer.start = async () => {};
  service.assetServer.stop = async () => {};

  await service.start();

  const result = await service.render({
    html: "<html></html>",
    output: "responsive",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    timeoutMs: 1_000,
    waitFor: "load",
    fullPage: true,
    javascriptEnabled: true,
    responsive: {
      includeScreenshots: false,
      viewports: [
        { name: "desktop", width: 1280, height: 720, deviceScaleFactor: 1 },
        { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
      ],
    },
  });

  const payload = JSON.parse(result.bytes.toString("utf8"));
  assert.equal(payload.contentType, "application/json; charset=utf-8");
  assert.equal(payload.responsive.items.length, 2);
  assert.deepEqual(payload.responsive.items.map((item) => item.name), ["desktop", "mobile"]);
  assert.equal(payload.responsive.items[1].viewport.width, 390);
  assert.equal(typeof payload.responsive.summary.worstScore, "number");
  assert.equal(Array.isArray(payload.responsive.summary.primarySignals), true);

  await service.stop();
});

test("RenderService returns diff JSON against a baseline image", async (t) => {
  const tempRoot = path.resolve(".tmp-tests");
  await fs.mkdir(tempRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tempRoot, "render-loop-diff-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const baselinePath = path.join(tempDir, "baseline.png");
  await fs.writeFile(baselinePath, Buffer.from("baseline-image"));

  const browserFactory = createBrowserFactory({
    pageFactory: () =>
      createDiffPage({
        diffResult: {
          width: 320,
          height: 240,
          currentWidth: 320,
          currentHeight: 240,
          baselineWidth: 320,
          baselineHeight: 240,
          changedPixels: 512,
          changedRatio: 0.0067,
          bounds: { x: 24, y: 18, width: 80, height: 54 },
          diffImageBase64: "DIFF",
        },
      }),
  });
  const service = new RenderService({
    concurrency: 1,
    recycleEvery: 10,
    launchBrowser: browserFactory.launchBrowser,
  });

  service.assetServer.start = async () => {};
  service.assetServer.stop = async () => {};

  await service.start();

  const result = await service.render({
    html: "<html></html>",
    output: "diff",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    timeoutMs: 1_000,
    waitFor: "load",
    fullPage: true,
    javascriptEnabled: true,
    diff: {
      baseImagePath: baselinePath,
      threshold: 16,
      includeImage: true,
    },
  });

  const payload = JSON.parse(result.bytes.toString("utf8"));
  assert.equal(payload.diff.width, 320);
  assert.equal(payload.diff.changedPixels, 512);
  assert.deepEqual(payload.diff.bounds, { x: 24, y: 18, width: 80, height: 54 });
  assert.equal(payload.diff.contentType, "image/png");
  assert.equal(payload.diff.diffImageBase64, "DIFF");

  await service.stop();
});

test("RenderService returns sequential state captures", async () => {
  const actionLog = [];
  const browserFactory = createBrowserFactory({
    pageFactory: () =>
      createStatesPage({
        screenshots: ["base", "hovered", "focused"],
        actionLog,
      }),
  });
  const service = new RenderService({
    concurrency: 1,
    recycleEvery: 10,
    launchBrowser: browserFactory.launchBrowser,
  });

  service.assetServer.start = async () => {};
  service.assetServer.stop = async () => {};

  await service.start();

  const result = await service.render({
    html: "<html></html>",
    output: "states",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    timeoutMs: 1_000,
    waitFor: "load",
    fullPage: true,
    javascriptEnabled: true,
    states: {
      includeBase: true,
      actions: [
        { name: "hover-cta", type: "hover", selector: ".cta" },
        { name: "focus-email", type: "focus", selector: "input[name=email]", waitForTimeoutMs: 120 },
      ],
    },
  });

  const payload = JSON.parse(result.bytes.toString("utf8"));
  assert.equal(payload.states.returned, 3);
  assert.deepEqual(payload.states.items.map((item) => item.name), ["base", "hover-cta", "focus-email"]);
  assert.equal(payload.states.items[1].type, "hover");
  assert.equal(payload.states.items[2].selector, "input[name=email]");
  assert.deepEqual(actionLog, [
    { type: "hover", selector: ".cta" },
    { type: "focus", selector: "input[name=email]" },
    { type: "wait", timeoutMs: 120 },
  ]);

  await service.stop();
});
