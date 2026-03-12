import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { mkdirParent, toJson, writeBuffer } from "./utils.js";

function requestJson({ host, port, pathName, method, body }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = http.request(
      {
        host,
        port,
        path: pathName,
        method,
        headers: payload
          ? {
              "content-length": String(payload.length),
              "content-type": "application/json; charset=utf-8",
            }
          : undefined,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            bytes: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on("error", reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function parseJsonOption(value, name) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

function parseCommaSeparatedInts(value) {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10));
}

function detectSpecialOutput(options) {
  const matches = [];
  if (options["patch-width"] || options["patch-height"] || options["patch-include"]) {
    matches.push("patches");
  }
  if (options.responsive) {
    matches.push("responsive");
  }
  if (options["diff-base-image"]) {
    matches.push("diff");
  }
  if (options.states) {
    matches.push("states");
  }
  return matches;
}

export async function fetchHealth({ host, port }) {
  const response = await requestJson({
    host,
    port,
    pathName: "/health",
    method: "GET",
  });
  if (response.statusCode !== 200) {
    const error = JSON.parse(response.bytes.toString("utf8"));
    throw new Error(error.error ?? `health request failed with status ${response.statusCode}`);
  }
  return JSON.parse(response.bytes.toString("utf8"));
}

export async function renderViaDaemon({ host, port, request, outFile }) {
  const response = await requestJson({
    host,
    port,
    pathName: "/render",
    method: "POST",
    body: request,
  });

  if (response.statusCode !== 200) {
    const error = JSON.parse(response.bytes.toString("utf8"));
    throw new Error(error.error ?? `daemon request failed with status ${response.statusCode}`);
  }

  const contentType = response.headers["content-type"];
  const encodedMeta = response.headers["x-render-loop-meta"];

  if (contentType?.startsWith("application/json")) {
    return JSON.parse(response.bytes.toString("utf8"));
  }

  const meta = encodedMeta
    ? JSON.parse(Buffer.from(String(encodedMeta), "base64").toString("utf8"))
    : { ok: true, contentType };

  if (outFile) {
    await writeBuffer(outFile, response.bytes);
    return {
      ...meta,
      outputPath: path.resolve(outFile),
    };
  }

  return {
    ...meta,
    bytesBase64: response.bytes.toString("base64"),
  };
}

export async function buildRenderRequestFromCli(options) {
  const specialOutputs = detectSpecialOutput(options);
  const output = options.output ?? specialOutputs[0] ?? "screenshot";
  if (specialOutputs.length > 1) {
    throw new Error("only one of patch, responsive, diff, or states CLI modes can be requested at a time");
  }
  if (options.output && specialOutputs.length === 1 && options.output !== specialOutputs[0]) {
    throw new Error(`${specialOutputs[0]} flags can only be used with --output ${specialOutputs[0]}`);
  }

  const request = {
    output,
    outputPath: options.out ? path.resolve(options.out) : undefined,
    selector: options.selector,
    fullPage: options["full-page"] === undefined ? true : options["full-page"] !== "false",
    timeoutMs: options.timeout ? Number.parseInt(options.timeout, 10) : undefined,
    viewport: {
      width: options.width ? Number.parseInt(options.width, 10) : 1280,
      height: options.height ? Number.parseInt(options.height, 10) : 720,
      deviceScaleFactor: options.scale ? Number.parseFloat(options.scale) : 1,
    },
    waitFor: options["wait-for-selector"]
      ? { selector: options["wait-for-selector"] }
      : options["wait-for-timeout"]
        ? { timeoutMs: Number.parseInt(options["wait-for-timeout"], 10) }
        : options["wait-for"] ?? "load",
  };

  if (specialOutputs.includes("patches")) {
    request.patches = {
      width: options["patch-width"] ? Number.parseInt(options["patch-width"], 10) : undefined,
      height: options["patch-height"] ? Number.parseInt(options["patch-height"], 10) : undefined,
      include: options["patch-include"] ? parseCommaSeparatedInts(options["patch-include"]) : undefined,
    };
  }
  if (specialOutputs.includes("responsive")) {
    request.responsive = parseJsonOption(options.responsive, "--responsive");
  }
  if (specialOutputs.includes("diff")) {
    request.diff = {
      baseImagePath: options["diff-base-image"],
      threshold: options["diff-threshold"] ? Number.parseFloat(options["diff-threshold"]) : undefined,
      includeImage: options["diff-include-image"] === undefined
        ? undefined
        : options["diff-include-image"] !== "false",
    };
  }
  if (specialOutputs.includes("states")) {
    request.states = parseJsonOption(options.states, "--states");
  }

  if (options.url) {
    return { ...request, url: options.url };
  }
  if (options["html-file"]) {
    return { ...request, htmlFile: options["html-file"] };
  }
  if (options["entry-file"]) {
    return { ...request, entryFile: options["entry-file"] };
  }
  if (options.html) {
    return { ...request, html: options.html };
  }
  return request;
}

export async function writeInlineFile(filePath, contents) {
  await mkdirParent(filePath);
  await fs.writeFile(filePath, contents);
}

export { toJson };
