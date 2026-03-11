import fs from "node:fs/promises";
import path from "node:path";

export function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      positionals.push(part);
      continue;
    }

    const key = part.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { positionals, options };
}

export function coerceInt(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

export function coerceFloat(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

export async function readMaybeFile(filePath) {
  if (!filePath) {
    return undefined;
  }
  return fs.readFile(filePath, "utf8");
}

export async function mkdirParent(filePath) {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
}

export function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeBuffer(filePath, buffer) {
  await mkdirParent(filePath);
  await fs.writeFile(filePath, buffer);
}

export function withDefault(value, fallback) {
  return value === undefined ? fallback : value;
}
