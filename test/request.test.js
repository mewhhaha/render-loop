import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRenderRequest } from "../src/request.js";

test("normalizeRenderRequest accepts a single source and defaults viewport", () => {
  const request = normalizeRenderRequest({
    url: "https://example.com",
  });

  assert.equal(request.url, "https://example.com");
  assert.deepEqual(request.viewport, {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  });
  assert.equal(request.output, "screenshot");
});

test("normalizeRenderRequest rejects multiple sources", () => {
  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        html: "<h1>bad</h1>",
      }),
    /exactly one of url, html, htmlFile, or entryFile is required/,
  );
});

test("normalizeRenderRequest rejects non-positive numeric fields", () => {
  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        timeoutMs: 0,
      }),
    /timeoutMs must be greater than zero/,
  );

  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        viewport: {
          width: 0,
        },
      }),
    /viewport.width must be greater than zero/,
  );
});

test("normalizeRenderRequest rejects unsupported outputs", () => {
  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        output: "zip",
      }),
    /output must be screenshot, pdf, html, inspect, patches, responsive, diff, or states/,
  );
});

test("normalizeRenderRequest accepts inspect output", () => {
  const request = normalizeRenderRequest({
    url: "https://example.com",
    output: "inspect",
  });

  assert.equal(request.output, "inspect");
});

test("normalizeRenderRequest accepts patches output", () => {
  const request = normalizeRenderRequest({
    url: "https://example.com",
    output: "patches",
    patches: {
      width: 320,
      height: 512,
      include: [0, 2],
    },
  });

  assert.equal(request.output, "patches");
  assert.deepEqual(request.patches, {
    width: 320,
    height: 512,
    include: [0, 2],
  });
});

test("normalizeRenderRequest requires patch dimensions for patches output", () => {
  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        output: "patches",
      }),
    /patches output requires a patches object with width and height/,
  );
});

test("normalizeRenderRequest rejects negative patch indexes", () => {
  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        output: "patches",
        patches: {
          width: 320,
          height: 512,
          include: [-1],
        },
      }),
    /patches.include values must be greater than or equal to zero/,
  );
});

test("normalizeRenderRequest rejects tiny patch dimensions", () => {
  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        output: "patches",
        patches: {
          width: 16,
          height: 64,
        },
      }),
    /patches.width and patches.height must be at least 32/,
  );
});

test("normalizeRenderRequest accepts responsive output with defaults", () => {
  const request = normalizeRenderRequest({
    url: "https://example.com",
    output: "responsive",
  });

  assert.equal(request.output, "responsive");
  assert.equal(request.responsive.includeScreenshots, false);
  assert.deepEqual(
    request.responsive.viewports.map((viewport) => viewport.name),
    ["desktop", "tablet", "mobile", "narrow"],
  );
});

test("normalizeRenderRequest accepts diff output", () => {
  const request = normalizeRenderRequest({
    url: "https://example.com",
    output: "diff",
    diff: {
      baseImagePath: "./fixtures/card.html",
      threshold: 18,
      includeImage: false,
    },
  });

  assert.equal(request.output, "diff");
  assert.match(request.diff.baseImagePath, /fixtures\/card\.html$/);
  assert.equal(request.diff.threshold, 18);
  assert.equal(request.diff.includeImage, false);
});

test("normalizeRenderRequest accepts states output", () => {
  const request = normalizeRenderRequest({
    url: "https://example.com",
    output: "states",
    states: {
      includeBase: false,
      actions: [
        {
          type: "hover",
          selector: ".card",
          waitForTimeoutMs: 120,
        },
      ],
    },
  });

  assert.equal(request.output, "states");
  assert.equal(request.states.includeBase, false);
  assert.deepEqual(request.states.actions, [
    {
      name: "hover-1",
      type: "hover",
      selector: ".card",
      waitForSelector: undefined,
      waitForTimeoutMs: 120,
    },
  ]);
});

test("normalizeRenderRequest rejects mismatched special mode options", () => {
  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        output: "screenshot",
        responsive: {},
      }),
    /responsive options may only be used with output responsive/,
  );

  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        output: "screenshot",
        diff: {
          baseImagePath: "./fixtures/card.html",
        },
      }),
    /diff options may only be used with output diff/,
  );

  assert.throws(
    () =>
      normalizeRenderRequest({
        url: "https://example.com",
        output: "screenshot",
        states: {
          actions: [{ type: "hover", selector: ".card" }],
        },
      }),
    /states options may only be used with output states/,
  );
});
