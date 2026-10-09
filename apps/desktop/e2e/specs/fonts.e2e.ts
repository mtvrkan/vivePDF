import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { bootApp, copyFixture, fixtures, openInViewer, openTool, t } from "../support/app.ts";

const JAPANESE = t("settings.fallbackFonts.sets.ja");
const missingPrefix = t("viewer.messages.fonts.missing", { language: JAPANESE, size: "" }).replace(/\s*\(\)\.?$/, "");
const fontMessage = () => $(`//div[@role="status"][contains(normalize-space(.), "${missingPrefix}")]`);

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

  it("draws the Japanese text with the bundled font and never asks for a download", async () => {
    const path = copyFixture(fixtures().japanese);
    await openInViewer(path);

    await browser.waitUntil(async () => (await darkPixels()) > 2000, {
      timeout: 60000,
      interval: 1000,
      timeoutMsg: "the Japanese text was not drawn with the bundled font",
    });
    await expect(fontMessage()).not.toBeDisplayed();
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_WORK_DIR as string, "fonts-japanese.png"));
  });

  it("has no font downloads left in the settings", async () => {
    await openTool("nav.settings");
    const tools = $(`//nav[@aria-label="${t("nav.settings")}"]//button[.//span[normalize-space(.)="${t("settings.sections.tools.title")}"]]`);
    await tools.waitForClickable();
    await tools.click();
    await $(`//*[normalize-space(.)="${t("settings.office.title")}"]`).waitForDisplayed({ timeout: 30000 });
    await expect($(`//*[normalize-space(.)="${t("settings.fallbackFonts.title")}"]`)).not.toBeDisplayed();
  });
});
