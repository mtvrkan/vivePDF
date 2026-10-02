import { existsSync } from "node:fs";
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

  it("asks for the Japanese font, downloads it from the mirror and draws the text", async () => {
    const path = copyFixture(fixtures().japanese);
    await openInViewer(path);
    const message = fontMessage();
    await message.waitForDisplayed({ timeout: 60000, timeoutMsg: "the missing-font message never appeared" });
    await browser.pause(1500);
    const before = await darkPixels();

    await message.$(`.//button[normalize-space(.)="${t("viewer.messages.fonts.download")}"]`).click();
    await message.waitForDisplayed({ reverse: true, timeout: 120000, timeoutMsg: "the document was not reloaded after the download" });
    const fontsDir = join(process.env.VIVEPDF_DATA_DIR as string, "fallback-fonts");
    expect(existsSync(join(fontsDir, "NotoSansJP-Regular.otf"))).toBe(true);

    await browser.waitUntil(async () => (await darkPixels()) > Math.max(before * 3, 2000), {
      timeout: 60000,
      interval: 1000,
      timeoutMsg: `the Japanese text was not drawn after the download (before ${before})`,
    });
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_WORK_DIR as string, "fonts-japanese.png"));
  });

  it("lists the installed set in the settings and keeps the others downloadable", async () => {
    await openTool("nav.settings");
    const tools = $(`//nav[@aria-label="${t("nav.settings")}"]//button[.//span[normalize-space(.)="${t("settings.sections.tools.title")}"]]`);
    await tools.waitForClickable();
    await tools.click();
    await $(`button[aria-label="${t("settings.fallbackFonts.remove")}: ${JAPANESE}"]`).waitForDisplayed({ timeout: 30000 });
    await expect($(`button[aria-label="${t("settings.fallbackFonts.download")}: ${t("settings.fallbackFonts.sets.ko")}"]`)).toBeDisplayed();
  });
});
