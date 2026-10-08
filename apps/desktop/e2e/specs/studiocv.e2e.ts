import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, button, chooseFromToolbarMenu, clickButton, dialogButton, fixtures, openTool, pressShortcut, t, waitForDialogsAnswered, waitForFile, workDir } from "../support/app.ts";

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

  it("imports a CV PDF after a review, undoes and redoes it, and keeps the CV in a JSON file", async () => {
    await $(`//*[@role="tab"][normalize-space(.)="${t("studio.cv.tabs.content")}"]`).click();
    answerDialogs(fixtures().resume);
    await chooseFromToolbarMenu(t("studio.cv.file.menu"), "pdf");
    await waitForDialogsAnswered();

    const replace = dialogButton(t("studio.cv.import.replace"));
    await replace.waitForClickable({ timeout: 60000 });
    await replace.click();
    await browser.waitUntil(async () => (await previewText()).includes("Jordan Rivera"), { timeout: 30000, timeoutMsg: "the imported CV never reached the preview" });
    expect(await previewText()).toContain("Northwind Studio");

    await pressShortcut("z");
    await browser.waitUntil(async () => (await previewText()).includes(t("studio.cv.sample.name")), { timeout: 30000, timeoutMsg: "undo did not bring the sample back" });
    await pressShortcut("y");
    await browser.waitUntil(async () => (await previewText()).includes("Jordan Rivera"), { timeout: 30000, timeoutMsg: "redo did not bring the import back" });

    const target = join(workDir(), "jordan-cv.json");
    answerDialogs(target);
    await chooseFromToolbarMenu(t("studio.cv.file.menu"), "save");
    await waitForFile(target);
    const saved = JSON.parse(readFileSync(target, "utf8")) as { format: string; profile: { name: string; experience: Array<{ organisation: string; current: boolean }> } };
    expect(saved.format).toBe("vivepdf-cv");
    expect(saved.profile.name).toBe("Jordan Rivera");
    expect(saved.profile.experience[0]).toMatchObject({ organisation: "Northwind Studio", current: true });
  });

  it("brings a removed entry back from the toast", async () => {
    const entries = () => $$('[data-cv-section="experience"] [data-reorder-index]');
    const count = await entries().length;
    expect(count).toBeGreaterThan(0);

    await clickButton(t("studio.cv.remove", { name: "Lead Designer" }));
    await browser.waitUntil(async () => (await entries().length) === count - 1, { timeoutMsg: "the entry was not removed" });
    await button(t("common.undo")).click();

    await browser.waitUntil(async () => (await entries().length) === count, { timeoutMsg: "the entry did not come back" });
    expect(await previewText()).toContain("Northwind Studio");
  });
});
