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
          const bytes = Buffer.concat(chunks);
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            bytes,
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
    : {
        ok: true,
        contentType,
      };

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
  const request = {
    output: options.output ?? "screenshot",
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
