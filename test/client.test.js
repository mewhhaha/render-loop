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
