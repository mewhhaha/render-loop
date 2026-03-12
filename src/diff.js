import { HttpError } from "./errors.js";

export async function createDiffArtifact({ page, currentScreenshotBytes, baselineScreenshotBytes, diff }) {
  try {
    const result = await page.evaluate(async (payload) => {
      function rgbaAt(data, index) {
        return [data[index], data[index + 1], data[index + 2], data[index + 3]];
      }

      function distance(left, right) {
        const dr = left[0] - right[0];
        const dg = left[1] - right[1];
        const db = left[2] - right[2];
        const da = left[3] - right[3];
        return Math.sqrt((dr * dr) + (dg * dg) + (db * db) + (da * da));
      }

      async function loadImage(dataUrl, label) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`failed to decode ${label} diff image`));
          image.src = dataUrl;
        });
      }

      const [currentImage, baselineImage] = await Promise.all([
        loadImage(payload.currentDataUrl, "current"),
        loadImage(payload.baselineDataUrl, "baseline"),
      ]);

      const width = Math.min(currentImage.naturalWidth || currentImage.width, baselineImage.naturalWidth || baselineImage.width);
      const height = Math.min(currentImage.naturalHeight || currentImage.height, baselineImage.naturalHeight || baselineImage.height);
      const currentCanvas = document.createElement("canvas");
      const baselineCanvas = document.createElement("canvas");
      const diffCanvas = document.createElement("canvas");
      currentCanvas.width = width;
      currentCanvas.height = height;
      baselineCanvas.width = width;
      baselineCanvas.height = height;
      diffCanvas.width = width;
      diffCanvas.height = height;
      const currentContext = currentCanvas.getContext("2d", { willReadFrequently: true });
      const baselineContext = baselineCanvas.getContext("2d", { willReadFrequently: true });
      const diffContext = diffCanvas.getContext("2d", { willReadFrequently: true });
      currentContext.drawImage(currentImage, 0, 0, width, height, 0, 0, width, height);
      baselineContext.drawImage(baselineImage, 0, 0, width, height, 0, 0, width, height);
      diffContext.drawImage(currentImage, 0, 0, width, height, 0, 0, width, height);

      const currentData = currentContext.getImageData(0, 0, width, height);
      const baselineData = baselineContext.getImageData(0, 0, width, height);
      const diffData = diffContext.getImageData(0, 0, width, height);

      let changedPixels = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const currentPixel = rgbaAt(currentData.data, index);
          const baselinePixel = rgbaAt(baselineData.data, index);
          if (distance(currentPixel, baselinePixel) > payload.threshold) {
            changedPixels += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            diffData.data[index] = 255;
            diffData.data[index + 1] = 76;
            diffData.data[index + 2] = 45;
            diffData.data[index + 3] = 255;
          } else {
            diffData.data[index] = Math.round(diffData.data[index] * 0.35);
            diffData.data[index + 1] = Math.round(diffData.data[index + 1] * 0.35);
            diffData.data[index + 2] = Math.round(diffData.data[index + 2] * 0.35);
            diffData.data[index + 3] = 255;
          }
        }
      }

      diffContext.putImageData(diffData, 0, 0);
      return {
        width,
        height,
        currentWidth: currentImage.naturalWidth || currentImage.width,
        currentHeight: currentImage.naturalHeight || currentImage.height,
        baselineWidth: baselineImage.naturalWidth || baselineImage.width,
        baselineHeight: baselineImage.naturalHeight || baselineImage.height,
        changedPixels,
        changedRatio: changedPixels / Math.max(1, width * height),
        bounds: maxX >= 0
          ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
          : null,
        diffImageBase64: payload.includeImage
          ? diffCanvas.toDataURL("image/png").slice("data:image/png;base64,".length)
          : undefined,
      };
    }, {
      currentDataUrl: `data:image/png;base64,${currentScreenshotBytes.toString("base64")}`,
      baselineDataUrl: `data:image/png;base64,${baselineScreenshotBytes.toString("base64")}`,
      threshold: diff.threshold,
      includeImage: diff.includeImage,
    });

    return {
      contentType: "application/json; charset=utf-8",
      diff: {
        contentType: result.diffImageBase64 ? "image/png" : undefined,
        ...result,
      },
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, error instanceof Error ? error.message : "failed to create diff");
  }
}
