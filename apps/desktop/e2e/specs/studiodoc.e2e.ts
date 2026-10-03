import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, openTool, pressShortcut, probe, t, waitForDialogsAnswered, waitForFile, workDir } from "../support/app.ts";

const BOLD_KEY = "b";
const ENTER = String.fromCharCode(0xe007);
const body = () => $('[data-testid="document-body"]');
const button = (label: string) => $(`//button[normalize-space(.)="${label}"]`);

describe("studio documents", () => {
  before(bootApp);

  it("writes a document with headings, lists and bold text and exports it with a cover and contents", async () => {
    await openTool("nav.studio");
    await $('[data-document-starter="blank"]').click();
    await $('[data-testid="document-editor"]').waitForDisplayed({ timeout: 30000 });

    await body().click();
    await browser.keys("# Quarterly report");
    await browser.keys(ENTER);
    await browser.keys("Sales grew in every region ");
    await pressShortcut(BOLD_KEY);
    await browser.keys("this quarter");
    await pressShortcut(BOLD_KEY);
    await browser.keys(ENTER);
    await browser.keys("- Türkiye şubesi");
    await browser.keys(ENTER);
    await browser.keys("Avrupa");
    await expect(body().$("h1")).toHaveText("Quarterly report");
    await expect(body().$("strong")).toHaveText("this quarter");
    await expect(body().$$("ul > li")).toBeElementsArrayOfSize(2);

    await $(`//*[@role="radio"][normalize-space(.)="${t("studio.doc.tabs.settings")}"]`).click();
    await $(`//label[.//*[normalize-space(.)="${t("studio.doc.settings.toc")}"]]`).click();
    await $(`//label[.//*[normalize-space(.)="${t("studio.doc.settings.cover")}"]]`).click();
    await $(`//*[@role="radio"][normalize-space(.)="${t("studio.doc.tabs.preview")}"]`).click();
    await expect($('[data-testid="document-preview-status"]')).toHaveText(t("studio.doc.preview.pages", { count: 3 }), { wait: 30000 });
    await $('[data-preview-page="1"] img').waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-document.png"));

    const output = join(workDir(), "Quarterly.pdf");
    await button(t("studio.toolbar.export")).click();
    await $('[role="dialog"]').waitForDisplayed();
    answerDialogs(output);
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("tools.browse")}"]`).click();
    await waitForDialogsAnswered();
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("studio.export.run")}"]`).click();
    await waitForFile(output);

    const result = probe(output);
    const texts = (result.pages ?? []).map((page) => page.text.replace(/\s+/g, " "));
    expect(result.pageCount).toBe(3);
    expect(texts[1]).toContain(t("studio.doc.settings.tocTitleDefault"));
    expect(texts[1]).toContain("Quarterly report");
    expect(texts[2]).toContain("Sales grew in every region this quarter");
    expect(texts[2]).toContain("Türkiye şubesi");
    expect(result.pages?.[2].spans.find((span) => span.text.includes("this quarter"))?.bold).toBe(true);
  });

  it("saves the document, reopens it from recent designs and keeps its text", async () => {
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("common.close")}"]`).click();
    await $('[role="dialog"]').waitForDisplayed({ reverse: true });
    const name = $(`input[aria-label="${t("studio.doc.name")}"]`);
    await name.setValue("Quarterly");
    await browser.waitUntil(async () => (await name.getValue()) === "Quarterly", { timeoutMsg: "the document name was not typed" });

    const file = join(workDir(), "Quarterly.vivedoc");
    answerDialogs(file);
    await pressShortcut("s");
    await waitForDialogsAnswered();
    await waitForFile(file);
    await expect($('[data-testid="document-save-state"]')).toHaveText("Quarterly.vivedoc");

    await $(`button[aria-label="${t("studio.toolbar.leave")}"]`).click();
    const recent = $('[data-recent-design="Quarterly"]');
    await recent.waitForDisplayed();
    await recent.click();
    await $('[data-testid="document-editor"]').waitForDisplayed({ timeout: 30000 });
    await expect(body().$("h1")).toHaveText("Quarterly report");
    await expect($('[data-testid="document-save-state"]')).toHaveText("Quarterly.vivedoc");
  });
});
