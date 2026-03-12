import path from "node:path";
import { HttpError } from "./errors.js";

const MIN_PATCH_DIMENSION = 32;
const MAX_PATCHES_INCLUDED = 256;
const RESPONSIVE_DEFAULT_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1100, deviceScaleFactor: 1 },
  { name: "tablet", width: 834, height: 1194, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
  { name: "narrow", width: 320, height: 568, deviceScaleFactor: 1 },
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIntegerArray(value) {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
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

function ensureString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, `${name} must be a non-empty string`);
  }
  return value;
}

function normalizeViewport(source, namePrefix) {
  return {
    width: ensurePositiveNumber(source.width, undefined, `${namePrefix}.width`),
    height: ensurePositiveNumber(source.height, undefined, `${namePrefix}.height`),
    deviceScaleFactor: ensurePositiveNumber(source.deviceScaleFactor, 1, `${namePrefix}.deviceScaleFactor`),
  };
}

function normalizePatches(source) {
  if (!isObject(source)) {
    throw new HttpError(400, "patches must be an object");
  }

  const patches = {
    width: ensurePositiveNumber(source.width, undefined, "patches.width"),
    height: ensurePositiveNumber(source.height, undefined, "patches.height"),
    include: source.include,
  };

  if (patches.include !== undefined && !isIntegerArray(patches.include)) {
    throw new HttpError(400, "patches.include must be an array of integers");
  }
  if (patches.include?.some((index) => index < 0)) {
    throw new HttpError(400, "patches.include values must be greater than or equal to zero");
  }
  if (patches.width < MIN_PATCH_DIMENSION || patches.height < MIN_PATCH_DIMENSION) {
    throw new HttpError(400, `patches.width and patches.height must be at least ${MIN_PATCH_DIMENSION}`);
  }
  if (patches.include && patches.include.length > MAX_PATCHES_INCLUDED) {
    throw new HttpError(400, `patches.include must contain at most ${MAX_PATCHES_INCLUDED} indexes`);
  }

  return patches;
}

function normalizeResponsive(source) {
  if (source !== undefined && !isObject(source)) {
    throw new HttpError(400, "responsive must be an object");
  }

  const viewportSources = Array.isArray(source?.viewports) && source.viewports.length > 0
    ? source.viewports
    : RESPONSIVE_DEFAULT_VIEWPORTS;
  const viewports = viewportSources.map((viewport, index) => {
    if (!isObject(viewport)) {
      throw new HttpError(400, `responsive.viewports[${index}] must be an object`);
    }
    return {
      name: typeof viewport.name === "string" && viewport.name.length > 0
        ? viewport.name
        : `viewport-${index + 1}`,
      ...normalizeViewport(viewport, `responsive.viewports[${index}]`),
    };
  });

  return {
    includeScreenshots: maybeBool(source?.includeScreenshots, false),
    viewports,
  };
}

function normalizeDiff(source) {
  if (!isObject(source)) {
    throw new HttpError(400, "diff must be an object");
  }

  return {
    baseImagePath: path.resolve(ensureString(source.baseImagePath, "diff.baseImagePath")),
    threshold: ensurePositiveNumber(source.threshold, 24, "diff.threshold"),
    includeImage: maybeBool(source.includeImage, true),
  };
}

function normalizeStates(source) {
  if (!isObject(source)) {
    throw new HttpError(400, "states must be an object");
  }
  if (!Array.isArray(source.actions) || source.actions.length === 0) {
    throw new HttpError(400, "states.actions must be a non-empty array");
  }

  return {
    includeBase: maybeBool(source.includeBase, true),
    actions: source.actions.map((action, index) => {
      if (!isObject(action)) {
        throw new HttpError(400, `states.actions[${index}] must be an object`);
      }
      const type = ensureString(action.type, `states.actions[${index}].type`);
      if (!["hover", "focus", "click"].includes(type)) {
        throw new HttpError(400, `unsupported state action type: ${type}`);
      }
      return {
        name: typeof action.name === "string" && action.name.length > 0
          ? action.name
          : `${type}-${index + 1}`,
        type,
        selector: ensureString(action.selector, `states.actions[${index}].selector`),
        waitForSelector: action.waitForSelector === undefined
          ? undefined
          : ensureString(action.waitForSelector, `states.actions[${index}].waitForSelector`),
        waitForTimeoutMs: action.waitForTimeoutMs === undefined
          ? undefined
          : ensurePositiveNumber(action.waitForTimeoutMs, undefined, `states.actions[${index}].waitForTimeoutMs`),
      };
    }),
  };
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
  if (!["screenshot", "pdf", "html", "inspect", "patches", "responsive", "diff", "states"].includes(output)) {
    throw new HttpError(400, "output must be screenshot, pdf, html, inspect, patches, responsive, diff, or states");
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

  if (body.patches !== undefined) {
    request.patches = normalizePatches(body.patches);
  }
  if (body.responsive !== undefined || output === "responsive") {
    request.responsive = normalizeResponsive(body.responsive);
  }
  if (body.diff !== undefined) {
    request.diff = normalizeDiff(body.diff);
  }
  if (body.states !== undefined) {
    request.states = normalizeStates(body.states);
  }

  if (request.output === "pdf" && request.html) {
    request.emulateMedia = body.emulateMedia === "screen" ? "screen" : "print";
  }

  if (request.output === "patches" && !request.patches) {
    throw new HttpError(400, "patches output requires a patches object with width and height");
  }
  if (request.output !== "patches" && request.patches) {
    throw new HttpError(400, "patches options may only be used with output patches");
  }
  if (request.output === "diff") {
    request.diff = normalizeDiff(body.diff);
  } else if (request.diff) {
    throw new HttpError(400, "diff options may only be used with output diff");
  }
  if (request.output === "states" && !request.states) {
    throw new HttpError(400, "states output requires a states object");
  }
  if (request.output !== "states" && request.states) {
    throw new HttpError(400, "states options may only be used with output states");
  }
  if (request.output === "responsive" && !request.responsive) {
    request.responsive = normalizeResponsive(undefined);
  }
  if (request.output !== "responsive" && request.responsive) {
    throw new HttpError(400, "responsive options may only be used with output responsive");
  }

  return request;
}
