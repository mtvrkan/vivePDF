import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, button, openTool, probe, t, waitForDialogsAnswered, waitForFile, workDir } from "../support/app.ts";

const inDialog = (xpath: string) => $(`//*[@role="dialog"]${xpath}`);

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

describe("studio business cards", () => {
  before(bootApp);

  it("opens a foil card, shows its finish on the canvas and exports an imposed sheet with spot plates", async () => {
    await openTool("nav.studio");
    const filter = $('[data-template-category="cards"]');
    await filter.waitForClickable({ timeout: 30000 });
    await filter.click();
    const card = $('[data-template="roseGoldPlumCard"]');
    await card.waitForExist({ timeout: 20000 });
    await card.scrollIntoView({ block: "center" });
    await card.click();
    await $('[data-testid="studio-viewport"] [data-element-id]').waitForExist({ timeout: 30000 });

    expect(await $$('[data-testid="studio-viewport"] [data-finish="foil"]').length).toBeGreaterThan(0);
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "cards-canvas.png"));

    const output = join(workDir(), "Rose card.pdf");
    await button(t("studio.toolbar.export")).click();
    await $('[role="dialog"]').waitForDisplayed();
    await inDialog(`//*[@role="radio"][normalize-space(.)="${t("studio.export.formats.pdf")}"]`).click();
    await inDialog(`//label[.//*[normalize-space(.)="${t("studio.export.print.enabled")}"]]`).click();
    await inDialog(`//*[@role="radio"][normalize-space(.)="${t("studio.export.print.sheets.a4")}"]`).click();
    await inDialog(`//*[@role="radio"][normalize-space(.)="${t("studio.export.print.plateModes.spot")}"]`).click();
    await expect($('[data-testid="studio-export-print"]')).toHaveText(expect.stringContaining(t("studio.export.print.dieCut", { value: 3 })));
    answerDialogs(output);
    await inDialog(`//button[normalize-space(.)="${t("tools.browse")}"]`).click();
    await waitForDialogsAnswered();
    await inDialog(`//button[normalize-space(.)="${t("studio.export.run")}"]`).click();
    await waitForFile(output);

    const result = probe(output);
    expect(result.pageCount).toBe(2);
    expect(Math.round(Math.min(result.pages?.[0].width ?? 0, result.pages?.[0].height ?? 0))).toBe(595);
    expect(result.layers).toBeGreaterThanOrEqual(2);
    const backs = occurrences(result.pages?.[1].text ?? "", t("studio.tpl.email"));
    expect(backs).toBeGreaterThanOrEqual(8);
  });
});
