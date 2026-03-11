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
