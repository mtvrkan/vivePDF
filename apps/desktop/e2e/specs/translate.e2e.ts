import { existsSync } from "node:fs";
import { $, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, chooseOption, clickButton, copyFixture, fixtures, openInViewer, openTool, t, waitForDialogsAnswered } from "../support/app.ts";

const PACKAGE = process.env.VIVEPDF_E2E_ARGOS_EN_TR;

async function openReadingSettings() {
  await openTool("nav.settings");
  await clickButton(t("settings.sections.reading.title"));
}

async function selectLineAndOpenMenu(pageIndex: number, fromX: number, toX: number, y: number) {
  const page = $(`[data-page-index="${pageIndex}"]`);
  await page.waitForDisplayed();
  await browser.waitUntil(async () => (await page.$$("img, canvas").length) > 0, { timeoutMsg: `page ${pageIndex + 1} never rendered` });
  const box = await browser.execute((index) => {
    const rect = (document.querySelector(`[data-page-index="${index}"]`) as HTMLElement).getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width };
  }, pageIndex);
  const scale = box.width / 595;
  const at = (x: number) => ({ origin: "viewport" as const, x: Math.round(box.left + x * scale), y: Math.round(box.top + y * scale) });
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move(at(fromX))
    .down()
    .move({ ...at((fromX + toX) / 2), duration: 150 })
    .move({ ...at(toX), duration: 150 })
    .up()
    .perform();
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move(at((fromX + toX) / 2))
    .down({ button: 2 })
    .up({ button: 2 })
    .perform();
}

describe("translate", () => {
  before(async function () {
    if (!PACKAGE || !existsSync(PACKAGE)) this.skip();
    await bootApp();
  });

  it("imports one direction of a language, translates a selection offline and removes the language", async () => {
    await openReadingSettings();
    answerDialogs(PACKAGE as string);
    await clickButton(t("settings.translate.import"));
    await waitForDialogsAnswered();
    const remove = $(`button[aria-label="${t("settings.translate.removeLanguage")}: Turkish"]`);
    const complete = $(`button[aria-label="${t("settings.translate.complete")}: Turkish"]`);
    await remove.waitForExist({ timeout: 120000 });
    await expect(complete).toBeExisting();

    await openInViewer(copyFixture(fixtures().sample, "translate.pdf"));
    await selectLineAndOpenMenu(0, 66, 231, 156);
    const translateMenu = $('[role="menuitem"][data-menu-id="translate-menu"]');
    await translateMenu.waitForClickable();
    await translateMenu.moveTo();
    const translateItem = $('[role="menuitem"][data-menu-id="translate"]');
    await translateItem.waitForClickable();
    await expect(translateItem).toHaveText(t("viewer.context.offlineTranslator"));
    await translateItem.click();
    const panel = $(`aside[aria-label="${t("viewer.translate.title")}"]`);
    await panel.waitForDisplayed();
    await chooseOption(t("viewer.translate.source"), "English");
    await chooseOption(t("viewer.translate.target"), "Turkish");

    const result = panel.$('p[lang="tr"]');
    await result.waitForDisplayed({ timeout: 120000 });
    const text = await result.getText();
    expect(text.toLocaleLowerCase("tr")).toContain("kahverengi");
    await expect(panel.$(`button[aria-label="${t("viewer.translate.copy")}"]`)).toBeDisplayed();

    await openReadingSettings();
    await remove.waitForClickable();
    await remove.click();
    await $(`button[aria-label="${t("settings.translate.downloadLanguage")}: Turkish"]`).waitForExist({ timeout: 30000 });
  });
});
