import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError } from "./errors.js";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

function ensureInside(rootDir, requestedPath) {
  const candidate = path.resolve(rootDir, `.${requestedPath}`);
  const relative = path.relative(rootDir, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(400, "requested asset escaped its mount root");
  }
  return candidate;
}

export class AssetServer {
  constructor({ host, port }) {
    this.host = host;
    this.port = port;
    this.server = null;
    this.mounts = new Map();
  }

  async start() {
    if (this.server) {
      return;
    }

    this.server = http.createServer((request, response) => {
      this.#handle(request, response).catch((error) => {
        const status = error instanceof HttpError ? error.status : 500;
        response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: error.message }));
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
  }

  async stop() {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  registerFile(filePath) {
    const absolute = path.resolve(filePath);
    const rootDir = path.dirname(absolute);
    const entryName = path.basename(absolute);
    const mountId = randomUUID();
    this.mounts.set(mountId, { rootDir });
    return {
      mountId,
      url: `http://${this.host}:${this.port}/mount/${mountId}/${encodeURIComponent(entryName)}`,
    };
  }

  unregisterMount(mountId) {
    this.mounts.delete(mountId);
  }

  async #handle(request, response) {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    const parts = pathname.split("/").filter(Boolean);

    if (parts.length < 3 || parts[0] !== "mount") {
      throw new HttpError(404, "unknown asset path");
    }

    const mount = this.mounts.get(parts[1]);
    if (!mount) {
      throw new HttpError(404, "unknown mount");
    }

    const relativePath = `/${parts.slice(2).map(decodeURIComponent).join("/")}`;
    const filePath = ensureInside(mount.rootDir, relativePath);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new HttpError(404, "asset is not a file");
    }

    const mimeType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
    const bytes = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-length": String(bytes.length),
      "content-type": mimeType,
      "cache-control": "no-store",
    });
    response.end(bytes);
  }
}
