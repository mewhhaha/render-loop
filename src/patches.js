import { HttpError } from "./errors.js";

const MAX_PATCHES_RETURNED = 256;

function uniqueIndexes(indexes) {
  return [...new Set(indexes)];
}

async function splitScreenshotIntoPatches(page, screenshotBytes, patches) {
  try {
    return await page.evaluate(async (payload) => {
      function buildDefaultIndexes(total) {
        return Array.from({ length: total }, (_, index) => index);
      }

      const image = await new Promise((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("failed to decode screenshot for patches"));
        nextImage.src = payload.dataUrl;
      });

      const imageWidth = image.naturalWidth || image.width;
      const imageHeight = image.naturalHeight || image.height;
      const columns = Math.max(1, Math.ceil(imageWidth / payload.patchWidth));
      const rows = Math.max(1, Math.ceil(imageHeight / payload.patchHeight));
      const total = rows * columns;
      if (!payload.include && total > payload.maxReturned) {
        throw new Error(
          `patch grids larger than ${payload.maxReturned} tiles require patch-include to select a subset`,
        );
      }
      const indexes = payload.include ?? buildDefaultIndexes(total);

      if (indexes.length > payload.maxReturned) {
        throw new Error(`patch requests may return at most ${payload.maxReturned} patches`);
      }

      for (const index of indexes) {
        if (!Number.isInteger(index) || index < 0 || index >= total) {
          throw new Error(`patch index ${index} is out of range for ${total} patches`);
        }
      }

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const overviewCanvas = document.createElement("canvas");
      const overviewContext = overviewCanvas.getContext("2d");
      const items = [];

      for (const index of indexes) {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const x = column * payload.patchWidth;
        const y = row * payload.patchHeight;
        const width = Math.min(payload.patchWidth, imageWidth - x);
        const height = Math.min(payload.patchHeight, imageHeight - y);

        canvas.width = width;
        canvas.height = height;
        context.clearRect(0, 0, width, height);
        context.drawImage(image, x, y, width, height, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/png");
        items.push({
          index,
          row,
          column,
          x,
          y,
          width,
          height,
          contentType: "image/png",
          bytesBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
        });
      }

      const overviewScale = Math.min(1, 240 / Math.max(imageWidth, imageHeight));
      overviewCanvas.width = Math.max(1, Math.round(imageWidth * overviewScale));
      overviewCanvas.height = Math.max(1, Math.round(imageHeight * overviewScale));
      overviewContext.drawImage(image, 0, 0, overviewCanvas.width, overviewCanvas.height);
      overviewContext.strokeStyle = "#ff4d2d";
      overviewContext.lineWidth = 2;
      for (const item of items) {
        overviewContext.strokeRect(
          Math.round(item.x * overviewScale),
          Math.round(item.y * overviewScale),
          Math.max(1, Math.round(item.width * overviewScale)),
          Math.max(1, Math.round(item.height * overviewScale)),
        );
      }
      const overviewDataUrl = overviewCanvas.toDataURL("image/jpeg", 0.72);

      return {
        imageWidth,
        imageHeight,
        patchWidth: payload.patchWidth,
        patchHeight: payload.patchHeight,
        rows,
        columns,
        total,
        returned: items.length,
        overview: {
          width: overviewCanvas.width,
          height: overviewCanvas.height,
          contentType: "image/jpeg",
          bytesBase64: overviewDataUrl.slice(overviewDataUrl.indexOf(",") + 1),
        },
        items,
      };
    }, {
      dataUrl: `data:image/png;base64,${screenshotBytes.toString("base64")}`,
      patchWidth: patches.width,
      patchHeight: patches.height,
      include: patches.include,
      maxReturned: MAX_PATCHES_RETURNED,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("out of range")) {
      throw new HttpError(400, error.message);
    }
    if (error instanceof Error && error.message.includes("at most")) {
      throw new HttpError(400, error.message);
    }
    if (error instanceof Error && error.message.includes("require patch-include")) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}

export async function createPatchesArtifact({ page, screenshotBytes, patches }) {
  return {
    contentType: "application/json; charset=utf-8",
    patches: await splitScreenshotIntoPatches(page, screenshotBytes, {
      width: patches.width,
      height: patches.height,
      include: patches.include ? uniqueIndexes(patches.include) : undefined,
    }),
  };
}
