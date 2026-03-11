import test from "node:test";
import assert from "node:assert/strict";
import { RenderService } from "../src/render_service.js";

function createFakeBrowserFactory() {
  let launchCount = 0;
  let closeCount = 0;
  let activePages = 0;
  const finishResolvers = [];

  function createPage() {
    return {
      on() {},
      async setContent() {},
      async waitForLoadState() {},
      async waitForTimeout() {},
      async content() {
        activePages += 1;
        await new Promise((resolve) => {
          finishResolvers.push(() => {
            activePages -= 1;
            resolve();
          });
        });
        return "<html></html>";
      },
    };
  }

  function createContext() {
    return {
      async newPage() {
        return createPage();
      },
      async close() {},
    };
  }

  function createBrowser() {
    let connected = true;
    let disconnectedHandler = () => {};
    return {
      isConnected() {
        return connected;
      },
      on(eventName, handler) {
        if (eventName === "disconnected") {
          disconnectedHandler = handler;
        }
      },
      async newContext() {
        return createContext();
      },
      async close() {
        connected = false;
        closeCount += 1;
        disconnectedHandler();
      },
    };
  }

  return {
    launchBrowser: async () => {
      launchCount += 1;
      return createBrowser();
    },
    getLaunchCount() {
      return launchCount;
    },
    getCloseCount() {
      return closeCount;
    },
    getActivePages() {
      return activePages;
    },
    releaseOne() {
      const resolve = finishResolvers.shift();
      if (resolve) {
        resolve();
      }
    },
  };
}

test("RenderService defers recycle until all in-flight jobs finish", async () => {
  const browserFactory = createFakeBrowserFactory();
  const service = new RenderService({
    concurrency: 2,
    recycleEvery: 1,
    launchBrowser: browserFactory.launchBrowser,
  });

  service.assetServer.start = async () => {};
  service.assetServer.stop = async () => {};

  await service.start();

  const request = {
    html: "<html></html>",
    output: "html",
    viewport: { width: 100, height: 100, deviceScaleFactor: 1 },
    timeoutMs: 1_000,
    waitFor: "load",
    fullPage: true,
    javascriptEnabled: true,
  };

  const firstRender = service.render(request);
  const secondRender = service.render(request);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(browserFactory.getLaunchCount(), 1);
  assert.equal(browserFactory.getCloseCount(), 0);
  assert.equal(browserFactory.getActivePages(), 2);

  browserFactory.releaseOne();
  await firstRender;
  assert.equal(browserFactory.getCloseCount(), 0);

  browserFactory.releaseOne();
  await secondRender;
  assert.equal(browserFactory.getCloseCount(), 1);
});
