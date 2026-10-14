import { join } from "node:path";
import { $, browser } from "@wdio/globals";
import { bootApp, copyFixture, fixtures, openInViewer } from "../support/app.ts";

async function darkPixels(): Promise<number> {
  const page = $('[data-page-index="0"]');
  await page.waitForDisplayed();
  const png = await browser.takeElementScreenshot(await page.elementId);
  return await browser.execute(async (data: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) count += 1;
    }
    return count;
  }, png);
}

describe("fallback fonts", () => {
  before(bootApp);

  it("draws the Japanese text with the bundled font", async () => {
    const path = copyFixture(fixtures().japanese);
    await openInViewer(path);

    await browser.waitUntil(async () => (await darkPixels()) > 2000, {
      timeout: 60000,
      interval: 1000,
      timeoutMsg: "the Japanese text was not drawn with the bundled font",
    });
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_WORK_DIR as string, "fonts-japanese.png"));
  });
});
