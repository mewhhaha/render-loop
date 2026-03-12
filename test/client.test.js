import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderRequestFromCli } from "../src/client.js";

test("buildRenderRequestFromCli keeps html-file as a file source", async () => {
  const request = await buildRenderRequestFromCli({
    "html-file": "./fixtures/card.html",
  });

  assert.equal(request.htmlFile, "./fixtures/card.html");
  assert.equal(request.html, undefined);
});

test("buildRenderRequestFromCli prefers url over other sources", async () => {
  const request = await buildRenderRequestFromCli({
    url: "https://example.com",
    "html-file": "./fixtures/card.html",
  });

  assert.equal(request.url, "https://example.com");
  assert.equal(request.htmlFile, undefined);
});

test("buildRenderRequestFromCli forwards inspect output", async () => {
  const request = await buildRenderRequestFromCli({
    url: "https://example.com",
    output: "inspect",
  });

  assert.equal(request.output, "inspect");
});

test("buildRenderRequestFromCli forwards patches options", async () => {
  const request = await buildRenderRequestFromCli({
    url: "https://example.com",
    "patch-width": "320",
    "patch-height": "480",
    "patch-include": "0,3,4",
  });

  assert.equal(request.output, "patches");
  assert.deepEqual(request.patches, {
    width: 320,
    height: 480,
    include: [0, 3, 4],
  });
});

test("buildRenderRequestFromCli rejects patch flags for non-patches output", async () => {
  await assert.rejects(
    () =>
      buildRenderRequestFromCli({
        url: "https://example.com",
        output: "screenshot",
        "patch-width": "320",
        "patch-height": "480",
      }),
    /patches flags can only be used with --output patches/,
  );
});

test("buildRenderRequestFromCli forwards responsive options", async () => {
  const request = await buildRenderRequestFromCli({
    url: "https://example.com",
    responsive: "{\"includeScreenshots\":true,\"viewports\":[{\"name\":\"mobile\",\"width\":390,\"height\":844}]}",
  });

  assert.equal(request.output, "responsive");
  assert.deepEqual(request.responsive, {
    includeScreenshots: true,
    viewports: [{ name: "mobile", width: 390, height: 844 }],
  });
});

test("buildRenderRequestFromCli forwards diff options", async () => {
  const request = await buildRenderRequestFromCli({
    url: "https://example.com",
    "diff-base-image": "./baseline.png",
    "diff-threshold": "16",
    "diff-include-image": "false",
  });

  assert.equal(request.output, "diff");
  assert.deepEqual(request.diff, {
    baseImagePath: "./baseline.png",
    threshold: 16,
    includeImage: false,
  });
});

test("buildRenderRequestFromCli forwards states options", async () => {
  const request = await buildRenderRequestFromCli({
    url: "https://example.com",
    states: "{\"includeBase\":false,\"actions\":[{\"type\":\"focus\",\"selector\":\"input[name=email]\"}]}",
  });

  assert.equal(request.output, "states");
  assert.deepEqual(request.states, {
    includeBase: false,
    actions: [{ type: "focus", selector: "input[name=email]" }],
  });
});

test("buildRenderRequestFromCli rejects multiple special outputs", async () => {
  await assert.rejects(
    () =>
      buildRenderRequestFromCli({
        url: "https://example.com",
        responsive: "{}",
        states: "{\"actions\":[{\"type\":\"hover\",\"selector\":\".card\"}]}",
      }),
    /only one of patch, responsive, diff, or states CLI modes can be requested at a time/,
  );
});
