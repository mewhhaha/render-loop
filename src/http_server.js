import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { RenderService } from "./render_service.js";
import { HttpError } from "./errors.js";
import { normalizeRenderRequest } from "./request.js";

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "request body must be valid JSON");
  }
}

function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(status, {
    "content-length": String(Buffer.byteLength(body)),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function splitArtifact(result) {
  return {
    meta: {
      ok: true,
      reusedBrowser: result.reusedBrowser,
      browserGeneration: result.browserGeneration,
      contentType: result.contentType,
      consoleMessages: result.consoleMessages,
      pageErrors: result.pageErrors,
      requestFailures: result.requestFailures,
      timing: result.timing,
    },
    bytes: result.bytes,
  };
}

export async function startHttpServer({
  host = "127.0.0.1",
  port = 4217,
  concurrency = 2,
  recycleEvery = 100,
  browserLaunchOptions = {},
} = {}) {
  const service = new RenderService({
    host,
    concurrency,
    recycleEvery,
    browserLaunchOptions,
  });
  await service.start();

  const server = http.createServer((request, response) => {
    handleRequest(service, request, response).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(response, status, {
        ok: false,
        error: error.message,
      });
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });
  } catch (error) {
    await service.stop().catch(() => {});
    throw error;
  }

  return {
    host,
    port: server.address().port,
    service,
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await service.stop();
    },
  };
}

async function handleRequest(service, request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      stats: service.stats(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/stats") {
    sendJson(response, 200, {
      ok: true,
      stats: service.stats(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/render") {
    const body = await readJsonBody(request);
    const renderRequest = normalizeRenderRequest(body);
    const result = await service.render(renderRequest);

    if (renderRequest.outputPath) {
      await fs.mkdir(path.dirname(renderRequest.outputPath), { recursive: true });
      await fs.writeFile(renderRequest.outputPath, result.bytes);
      sendJson(response, 200, {
        ok: true,
        outputPath: renderRequest.outputPath,
        reusedBrowser: result.reusedBrowser,
        browserGeneration: result.browserGeneration,
        contentType: result.contentType,
        consoleMessages: result.consoleMessages,
        pageErrors: result.pageErrors,
        requestFailures: result.requestFailures,
        timing: result.timing,
      });
      return;
    }

    const { meta, bytes } = splitArtifact(result);
    response.writeHead(200, {
      "content-length": String(bytes.length),
      "content-type": result.contentType,
      "x-render-loop-meta": Buffer.from(JSON.stringify(meta)).toString("base64"),
    });
    response.end(bytes);
    return;
  }

  throw new HttpError(404, "not found");
}
