import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, openTool, pressShortcut, probe, t, waitForDialogsAnswered, waitForFile, workDir } from "../support/app.ts";

const BOLD_KEY = "b";
const ENTER = String.fromCharCode(0xe007);
const END = String.fromCharCode(0xe010);
const ESCAPE = String.fromCharCode(0xe00c);
const body = () => $('[data-testid="document-body"]');
const button = (label: string) => $(`//button[normalize-space(.)="${label}"]`);

describe("studio documents", () => {
  before(bootApp);

  it("writes a document with headings, lists and bold text and exports it with a cover and contents", async () => {
    await openTool("nav.studio");
    await $('[data-studio-section="document"]').click();
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

    const menuItem = (label: string) => $(`//*[@role="menuitemcheckbox"][normalize-space(.)="${label}"]`);
    await $('[data-ribbon-tab="references"]').click();
    await $('[data-testid="doc-toc"]').click();
    await menuItem(t("studio.doc.settings.depth", { count: 2 })).click();
    await $('[data-ribbon-tab="insert"]').click();
    await $('[data-testid="doc-cover"]').click();
    await menuItem(t("studio.doc.covers.classic")).click();
    await $('[data-testid="doc-cover-details"]').waitForDisplayed();
    await $('[role="dialog"] [data-dialog-close]').click();
    await $('[data-testid="doc-insert-header"]').click();
    await expect($('[data-ribbon-tab="furniture"]')).toHaveAttribute("aria-selected", "true");
    await browser.keys("Quarterly report");
    await browser.keys(ESCAPE);
    await expect($('[data-testid="sheet-header"]')).toHaveValue("Quarterly report");
    await expect($('[data-ribbon-tab="furniture"]')).not.toBeExisting();
    await expect($('[data-testid="document-page-count"]')).toHaveText(t("studio.doc.status.page", { page: 3, count: 3 }), { wait: 30000 });
    await $('[data-testid="document-print-preview-open"]').click();
    await $('[data-testid="document-print-preview"] [data-preview-page="1"] img').waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-document.png"));
    await $('[role="dialog"] [data-dialog-close]').click();

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
    await $('[data-studio-section="home"]').click();
    const recent = $('[data-recent-design="Quarterly"]');
    await recent.waitForDisplayed();
    await recent.click();
    await $('[data-testid="document-editor"]').waitForDisplayed({ timeout: 30000 });
    await expect(body().$("h1")).toHaveText("Quarterly report");
    await expect($('[data-testid="document-save-state"]')).toHaveText("Quarterly.vivedoc");
  });

  it("saves the words typed right before Ctrl+S and shows the document as saved", async () => {
    const file = join(workDir(), "Quarterly.vivedoc");
    await body().$("h1").click();
    await browser.keys(["End"]);
    await browser.keys(" final words");
    await pressShortcut("s");

    await browser.waitUntil(() => readFileSync(file, "utf8").includes("Quarterly report final words"), { timeoutMsg: "the last typed words never reached the saved file" });
    await browser.pause(500);
    await expect($('[data-testid="document-save-state"]')).toHaveText("Quarterly.vivedoc");
  });

  it("sets the margin from the Layout ribbon tab and shows the Table tab only inside a table", async () => {
    await $('[data-ribbon-tab="layout"]').click();
    await $('[data-testid="doc-margins"]').click();
    await $(`//*[@role="menuitemcheckbox"][normalize-space(.)="${t("studio.doc.ribbon.marginValue", { value: 30 })}"]`).click();
    await $('[data-testid="doc-page-settings"]').click();
    await $('[data-testid="page-setup"]').waitForDisplayed();
    for (const side of ["marginTopMm", "marginBottomMm", "marginLeftMm", "marginRightMm"]) {
      await expect($(`//label[./span[normalize-space(.)="${t(`studio.doc.pageSetup.${side}`)}"]]//input`)).toHaveValue("30");
    }
    const gutter = $(`//label[./span[normalize-space(.)="${t("studio.doc.pageSetup.gutter")}"]]//input`);
    await gutter.setValue("10");
    await browser.keys("Enter");
    await expect(gutter).toHaveValue("10");
    await expect($('[data-testid="page-setup-too-small"]')).not.toBeDisplayed();
    await $('[role="dialog"] [data-dialog-close]').click();

    await $('[data-ribbon-tab="insert"]').click();
    await $('[data-testid="doc-insert-table"]').click();
    await $('[data-ribbon-tab="table"]').waitForDisplayed();
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-document-ribbon.png"));
    await body().$("h1").click();
    await $('[data-ribbon-tab="table"]').waitForDisplayed({ reverse: true });
  });

  it("draws a page line where the engine starts the next page and counts the caret's page", async () => {
    await body().$$("ul > li")[1].click();
    await browser.keys(END);
    await browser.keys(ENTER);
    await browser.keys(ENTER);
    await pressShortcut(ENTER);
    await browser.keys("Next page");
    await $('[data-page-line="4"]').waitForExist({ timeout: 30000 });
    await expect($('[data-testid="document-page-count"]')).toHaveText(t("studio.doc.status.page", { page: 4, count: 4 }), { wait: 30000 });
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-document-page-lines.png"));

    await $('[data-ribbon-tab="view"]').click();
    await $('[data-testid="doc-page-lines"]').click();
    await $('[data-page-line="4"]').waitForExist({ reverse: true });
    await $('[data-testid="doc-page-lines"]').click();
  });

  it("indents the caret's paragraph and moves the margin from the ruler", async () => {
    await body().$("p").click();
    const hanging = $('[data-testid="ruler-indent-hanging"]');
    await hanging.waitForDisplayed();
    await browser.execute((element) => (element as unknown as HTMLElement).focus(), await hanging);
    for (let step = 0; step < 2; step += 1) await browser.keys(["Shift", "ArrowRight"]);
    await expect(body().$("p")).toHaveAttribute("style", expect.stringContaining("text-indent: -28.35pt"));
    await expect(body().$("p")).toHaveAttribute("style", expect.stringContaining("margin-left: 28.35pt"));

    const margin = $('[data-testid="ruler-margin-left"]');
    const before = Number(await margin.getAttribute("aria-valuenow"));
    await browser.execute((element) => (element as unknown as HTMLElement).focus(), await margin);
    await browser.keys(["Shift", "ArrowRight"]);
    await expect(margin).toHaveAttribute("aria-valuenow", String(before + 5));
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-document-ruler.png"));

    await $('[data-ribbon-tab="view"]').click();
    await $('[data-testid="doc-ruler"]').click();
    await $('[data-testid="document-ruler"]').waitForExist({ reverse: true });
    await $('[data-testid="doc-ruler"]').click();
    await $('[data-testid="document-ruler"]').waitForDisplayed();
  });

  it("lists the headings in the navigation pane and moves the caret to the one clicked", async () => {
    await body().$(":scope > p:last-of-type").click();
    await browser.keys(END);
    await browser.keys(ENTER);
    await browser.keys("## Next quarter");
    await $('[data-ribbon-tab="view"]').click();
    await $('[data-testid="doc-navigation"]').click();
    const headings = $$('[data-testid="document-navigation-heading"]');
    await expect(headings).toBeElementsArrayOfSize(2);
    await expect($('[data-testid="document-navigation-heading"][aria-current="location"]')).toHaveText("Next quarter");

    await headings[0].click();
    await expect($('[data-testid="document-navigation-heading"][aria-current="location"]')).toHaveText("Quarterly report");
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-document-navigation.png"));

    await $('[data-ribbon-tab="view"]').click();
    await $('[data-testid="doc-navigation"]').click();
    await $('[data-testid="document-navigation"]').waitForExist({ reverse: true });
  });

  it("numbers the headings on the sheet from Design › Heading numbers and takes the numbers off again", async () => {
    await $('[data-ribbon-tab="design"]').click();
    await $('[data-testid="doc-heading-numbers"]').click();
    await $(`//*[@role="menuitemcheckbox"][normalize-space(.)="${t("studio.doc.headingNumbers.dotted")}"]`).click();
    await expect(body().$("h1")).toHaveText("1. Quarterly report");
    await expect(body().$("h2")).toHaveText("1.1. Next quarter");
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-document-heading-numbers.png"));

    await $('[data-testid="doc-heading-numbers"]').click();
    await $(`//*[@role="menuitemcheckbox"][normalize-space(.)="${t("studio.doc.headingNumbers.none")}"]`).click();
    await expect(body().$("h1")).toHaveText("Quarterly report");
  });

  it("starts the main text at the heading the caret is on and numbers the pages from there", async () => {
    await body().$("h2").click();
    await browser.keys(String.fromCharCode(0xe011));
    await $('[data-ribbon-tab="layout"]').click();
    await $('[data-testid="doc-main-matter"]').click();
    await expect(body().$('.page-break[data-main="true"]')).toHaveAttribute("aria-label", t("studio.doc.mainMatter.label"));

    await $('[data-ribbon-tab="design"]').click();
    await $('[data-testid="doc-heading-numbers"]').click();
    await $(`//*[@role="menuitemcheckbox"][normalize-space(.)="${t("studio.doc.headingNumbers.plain")}"]`).click();
    await expect(body().$("h1")).toHaveText("Quarterly report");
    await expect(body().$("h2")).toHaveText("0.1 Next quarter");
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-document-main-matter.png"));
  });

  it("adds a numbered figure caption from References and lists it in front of the text", async () => {
    await body().$(":scope > p:last-of-type").click();
    await $('[data-ribbon-tab="references"]').click();
    await $('[data-testid="doc-caption"]').click();
    await $(`//*[@role="menuitem"][normalize-space(.)="${t("studio.doc.caption.figure")}"]`).click();
    await browser.keys("Sales by region");
    await expect(body().$("p.vp-caption")).toHaveText(`${t("studio.doc.caption.figureLabel")} 1. Sales by region`);

    await $('[data-testid="doc-caption-lists"]').click();
    await $(`//*[@role="menuitemcheckbox"][normalize-space(.)="${t("studio.doc.caption.figureList")}"]`).click();
    await $('[data-testid="doc-caption-lists"]').click();
    await expect($(`//*[@role="menuitemcheckbox"][normalize-space(.)="${t("studio.doc.caption.figureList")}"]`)).toHaveAttribute("aria-checked", "true");
    await browser.keys(ESCAPE);
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-document-caption.png"));
  });
});
