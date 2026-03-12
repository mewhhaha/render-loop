import { HttpError } from "./errors.js";

async function maybeWaitAfterAction(page, action, timeoutMs) {
  if (action.waitForSelector) {
    await page.locator(action.waitForSelector).first().waitFor({ timeout: timeoutMs });
  }
  if (action.waitForTimeoutMs) {
    await page.waitForTimeout(action.waitForTimeoutMs);
  }
}

async function runAction(page, action, timeoutMs) {
  const locator = page.locator(action.selector).first();
  await locator.waitFor({ timeout: timeoutMs });
  if (action.type === "hover") {
    await locator.hover({ timeout: timeoutMs });
  } else if (action.type === "focus") {
    await locator.focus({ timeout: timeoutMs });
  } else if (action.type === "click") {
    await locator.click({ timeout: timeoutMs });
  } else {
    throw new HttpError(400, `unsupported state action type: ${action.type}`);
  }
  await maybeWaitAfterAction(page, action, timeoutMs);
}

export async function createStateCaptureArtifact({
  page,
  request,
  states,
}) {
  const items = [];

  if (states.includeBase) {
    items.push({
      name: "base",
      type: "base",
      contentType: "image/png",
      bytesBase64: (await page.screenshot({
        type: "png",
        fullPage: request.fullPage,
        clip: request.clip,
      })).toString("base64"),
    });
  }

  for (const action of states.actions) {
    await runAction(page, action, request.timeoutMs);
    items.push({
      name: action.name,
      type: action.type,
      selector: action.selector,
      contentType: "image/png",
      bytesBase64: (await page.screenshot({
        type: "png",
        fullPage: request.fullPage,
        clip: request.clip,
      })).toString("base64"),
    });
  }

  return {
    contentType: "application/json; charset=utf-8",
    states: {
      includeBase: states.includeBase,
      viewport: request.viewport,
      returned: items.length,
      items,
    },
  };
}
