import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { bootApp, openTool, t } from "../support/app.ts";

const preview = () => $(`[aria-label="${t("studio.cv.preview")}"]`);

async function previewText(): Promise<string> {
  return browser.execute((label: string) => document.querySelector(`[aria-label="${label}"]`)?.textContent ?? "", t("studio.cv.preview"));
}

describe("cv builder", () => {
  before(bootApp);

  it("fills the sample, shows every layout as a picture and switches the layout", async () => {
    await openTool("nav.studio");
    await $('[data-testid="studio-cv-start"]').click();
    await $('[data-testid="cv-studio"]').waitForDisplayed({ timeout: 30000 });

    await $(`//button[normalize-space(.)="${t("studio.cv.fillSample")}"]`).click();
    await browser.waitUntil(async () => (await previewText()).includes(t("studio.cv.sample.name")), { timeout: 30000, timeoutMsg: "the sample CV never reached the preview" });

    await $(`//*[@role="tab"][normalize-space(.)="${t("studio.cv.tabs.design")}"]`).click();
    await browser.waitUntil(async () => (await $$('[data-cv-layout] img[data-thumbnail-state="ready"]').length) === 10, { timeout: 90000, timeoutMsg: "the layout pictures were not all drawn" });
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "cv-layouts.png"));

    const before = await previewText();
    await $('[data-cv-layout="classic"]').click();
    await expect($('[data-cv-layout="classic"]')).toHaveAttribute("aria-pressed", "true");
    await browser.waitUntil(async () => (await preview().$$("[data-element-id]").length) > 0 && (await previewText()) !== "", { timeout: 30000 });
    expect((await previewText()).includes(t("studio.cv.sample.name"))).toBe(true);
    expect(before.length).toBeGreaterThan(0);
  });
});
