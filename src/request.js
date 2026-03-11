import path from "node:path";
import { HttpError } from "./errors.js";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function maybeBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function ensureNumber(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, `${name} must be a finite number`);
  }
  return value;
}

function ensurePositiveNumber(value, fallback, name) {
  const parsed = ensureNumber(value, fallback, name);
  if (parsed <= 0) {
    throw new HttpError(400, `${name} must be greater than zero`);
  }
  return parsed;
}

export function normalizeRenderRequest(body) {
  if (!isObject(body)) {
    throw new HttpError(400, "request body must be a JSON object");
  }

  const sourceKeys = ["url", "html", "htmlFile", "entryFile"].filter((key) => body[key] !== undefined);
  if (sourceKeys.length !== 1) {
    throw new HttpError(400, "exactly one of url, html, htmlFile, or entryFile is required");
  }

  const output = body.output ?? "screenshot";
  if (!["screenshot", "pdf", "html"].includes(output)) {
    throw new HttpError(400, "output must be screenshot, pdf, or html");
  }

  const viewportSource = isObject(body.viewport) ? body.viewport : {};
  const viewport = {
    width: ensurePositiveNumber(viewportSource.width, 1280, "viewport.width"),
    height: ensurePositiveNumber(viewportSource.height, 720, "viewport.height"),
    deviceScaleFactor: ensurePositiveNumber(viewportSource.deviceScaleFactor, 1, "viewport.deviceScaleFactor"),
  };

  const waitFor = body.waitFor ?? "load";
  if (
    typeof waitFor !== "string" &&
    !(isObject(waitFor) && (typeof waitFor.selector === "string" || typeof waitFor.timeoutMs === "number"))
  ) {
    throw new HttpError(400, "waitFor must be a lifecycle string or an object with selector/timeoutMs");
  }

  const selector = body.selector;
  if (selector !== undefined && typeof selector !== "string") {
    throw new HttpError(400, "selector must be a string");
  }

  const clip = body.clip;
  if (clip !== undefined) {
    if (
      !isObject(clip) ||
      !["x", "y", "width", "height"].every((key) => typeof clip[key] === "number" && Number.isFinite(clip[key]))
    ) {
      throw new HttpError(400, "clip must be an object with finite x, y, width, and height");
    }
  }

  const request = {
    url: typeof body.url === "string" ? body.url : undefined,
    html: typeof body.html === "string" ? body.html : undefined,
    htmlFile: typeof body.htmlFile === "string" ? path.resolve(body.htmlFile) : undefined,
    entryFile: typeof body.entryFile === "string" ? path.resolve(body.entryFile) : undefined,
    output,
    outputPath: typeof body.outputPath === "string" ? path.resolve(body.outputPath) : undefined,
    selector,
    clip,
    viewport,
    timeoutMs: ensurePositiveNumber(body.timeoutMs, 30_000, "timeoutMs"),
    waitFor,
    fullPage: maybeBool(body.fullPage, true),
    javascriptEnabled: maybeBool(body.javascriptEnabled, true),
    extraHeaders: isObject(body.extraHeaders) ? body.extraHeaders : undefined,
  };

  if (request.output === "pdf" && request.html) {
    request.emulateMedia = body.emulateMedia === "screen" ? "screen" : "print";
  }

  return request;
}
