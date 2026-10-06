import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, fixtures, openInViewer, openTool, pressShortcut, probe, t, typeInto, waitForDialogsAnswered, waitForFile, workDir } from "../support/app.ts";

const elements = () => $$('[data-testid="studio-viewport"] [data-element-id]');
const button = (label: string) => $(`//button[normalize-space(.)="${label}"]`);
const ESCAPE = String.fromCharCode(0xe00c);

async function modelX(index: number) {
  return browser.execute((position: number) => {
    const nodes = document.querySelectorAll<HTMLElement>('[data-testid="studio-viewport"] [data-element-id]');
    return Number.parseFloat(nodes[position].style.left);
  }, index);
}

async function canvasLine(text: string) {
  return browser.execute((wanted: string) => {
    const page = document.querySelector('[data-testid="studio-viewport"] [role="region"]') as HTMLElement;
    const host = page.getBoundingClientRect();
    const zoom = host.width / Number.parseFloat((page.firstElementChild as HTMLElement).style.width);
    const spans = Array.from(page.querySelectorAll<HTMLElement>("[data-element-id] span[data-b]"));
    const owner = spans.find((span) => span.closest("[data-element-id]")?.textContent?.includes(wanted));
    const body = owner?.parentElement as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(body);
    const rect = range.getBoundingClientRect();
    return { left: (rect.left - host.left) / zoom, right: (rect.right - host.left) / zoom };
  }, text);
}

describe("studio", () => {
  before(bootApp);

  it("builds a design, edits rich text, undoes a move and exports a PDF that matches the canvas", async () => {
    await openTool("nav.studio");
    await $('[data-size="a4Landscape"]').click();
    await $('[data-testid="studio-editor"]').waitForDisplayed({ timeout: 30000 });

    await button(t("studio.elements.heading")).click();
    await $(`button[aria-label="${t("studio.shapes.star")}"]`).click();

    const star = (await elements())[1];
    await $('[data-testid="studio-viewport"]').click({ x: 5, y: 5 });
    const before = await modelX(1);
    await browser.action("pointer").move({ origin: star }).down().move({ origin: star, x: 90, y: 50, duration: 300 }).up().perform();
    expect(await modelX(1)).toBeGreaterThan(before + 30);
    await pressShortcut("z");
    await browser.waitUntil(async () => Math.abs((await modelX(1)) - before) < 0.01, { timeoutMsg: "undo did not put the star back" });

    const heading = (await elements())[0];
    const headingWidth = await browser.execute((node: HTMLElement) => node.getBoundingClientRect().width, heading as unknown as HTMLElement);
    await browser
      .action("pointer")
      .move({ origin: heading, x: -Math.round(headingWidth * 0.4), y: 0 })
      .down()
      .up()
      .pause(60)
      .down()
      .up()
      .perform();
    const box = $('[data-testid="studio-viewport"] [role="textbox"]');
    await box.waitForDisplayed();
    await pressShortcut("a");
    await browser.keys("Hello Studio İğ");
    await browser.execute(() => {
      const editor = document.querySelector('[data-testid="studio-viewport"] [role="textbox"]') as HTMLElement;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode() as Text;
      const start = node.data.indexOf("Studio");
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + "Studio".length);
      const selection = window.getSelection() as Selection;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await pressShortcut("b");
    await browser.keys(ESCAPE);
    await box.waitForDisplayed({ reverse: true });
    await expect($('[data-testid="studio-viewport"] span[data-b="0"]')).toHaveText("Studio");
    answerDialogs(fixtures().red);
    await button(t("studio.elements.image")).click();
    await waitForDialogsAnswered();
    answerDialogs(fixtures().logo);
    await button(t("studio.elements.image")).click();
    await waitForDialogsAnswered();
    await browser.waitUntil(async () => (await elements().length) === 4, { timeoutMsg: "four elements were not added" });
    await $('[data-testid="studio-viewport"] [data-element-id] img').waitForDisplayed({ timeout: 30000 });

    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-canvas.png"));
    const line = await canvasLine("Hello");

    const output = join(workDir(), "Studio design.pdf");
    await button(t("studio.toolbar.export")).click();
    answerDialogs(output);
    await $('[role="dialog"]').waitForDisplayed();
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("tools.browse")}"]`).click();
    await waitForDialogsAnswered();
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("studio.export.run")}"]`).click();
    await waitForFile(output);

    const result = probe(output);
    expect(result.pageCount).toBe(1);
    const page = result.pages?.[0];
    expect(page?.width).toBeCloseTo(841.89, 0);
    expect(page?.text.replace(/\s+/g, " ")).toContain("Hello Studio İğ");
    expect(page?.images).toBe(1);
    expect(page?.drawings).toBeGreaterThanOrEqual(2);
    const spans = page?.spans ?? [];
    const regular = spans.find((span) => span.text.trim() === "Studio");
    expect(regular?.bold).toBe(false);
    const first = spans.find((span) => span.text.startsWith("Hello"));
    expect(first?.bold).toBe(true);
    const last = spans.find((span) => span.text.includes("İğ"));
    expect(Math.abs((first?.box[0] ?? 0) - line.left)).toBeLessThan(0.5);
    expect(Math.abs((last?.box[2] ?? 0) - line.right)).toBeLessThan(0.75);

    const picture = join(workDir(), "Studio design.png");
    await $(`//*[@role="dialog"]//*[@role="radio"][normalize-space(.)="${t("studio.export.formats.png")}"]`).click();
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("studio.export.run")}"]`).click();
    await waitForFile(picture);
    expect(existsSync(picture)).toBe(true);
  });

  it("saves the design, reopens it from recent designs and from the PDF it was exported to", async () => {
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("common.close")}"]`).click();
    await $('[role="dialog"]').waitForDisplayed({ reverse: true });
    const name = $(`input[aria-label="${t("studio.toolbar.name")}"]`);
    await name.setValue("Poster");
    await browser.waitUntil(async () => (await name.getValue()) === "Poster", { timeoutMsg: "the design name was not typed" });

    const project = join(workDir(), "Poster.vivedesign");
    answerDialogs(project);
    await pressShortcut("s");
    await waitForDialogsAnswered();
    await waitForFile(project);
    await expect($('[data-testid="studio-save-state"]')).toHaveText("Poster.vivedesign");

    await $(`button[aria-label="${t("studio.toolbar.leave")}"]`).click();
    const recent = $('[data-recent-design="Poster"]');
    await recent.waitForDisplayed();
    await expect(recent.$("img")).toBeDisplayed();
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-start.png"));
    await recent.click();
    await $('[data-testid="studio-editor"]').waitForDisplayed({ timeout: 30000 });
    await browser.waitUntil(async () => (await elements().length) === 4, { timeoutMsg: "the saved design did not come back with its four elements" });
    await expect($(`input[aria-label="${t("studio.toolbar.name")}"]`)).toHaveValue("Poster");

    await openTool("nav.viewer");
    await openInViewer(join(workDir(), "Studio design.pdf"));
    const edit = $('[data-testid="edit-in-studio"]');
    await edit.waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-viewer-bar.png"));
    await edit.click();
    await $('[data-testid="studio-editor"]').waitForDisplayed({ timeout: 30000 });
    await browser.waitUntil(async () => (await elements().length) === 4, { timeoutMsg: "the design in the PDF did not open with its four elements" });
    await expect($('[data-testid="studio-save-state"]')).toHaveText(t("studio.project.notSaved"));
    await $('[data-testid="studio-viewport"] [data-element-id] img').waitForDisplayed({ timeout: 30000 });
  });

  it("downloads a library font, shows it on the canvas and embeds it where the canvas put the text", async function () {
    if (!process.env.VIVEPDF_FONT_LIBRARY_URL) this.skip();
    await button(t("studio.elements.heading")).click();
    const picker = $(`[role="combobox"][aria-label="${t("fontPicker.label")}"]`);
    await picker.click();
    await $(`input[placeholder="${t("fontPicker.search")}"]`).setValue("Lora");
    await $(`//*[@role="option"][starts-with(normalize-space(.), "Lora")]`).click();
    await browser.waitUntil(async () => (await picker.getText()).trim() === "Lora", { timeout: 60000, timeoutMsg: "Lora was not downloaded and chosen" });
    const heading = t("studio.elements.headingText");
    await browser.waitUntil(
      () =>
        browser.execute((wanted: string) => {
          const span = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="studio-viewport"] span[data-b]')).find((item) => item.textContent === wanted);
          return Boolean(span && getComputedStyle(span).fontFamily.includes("vp-studio") && document.fonts.status === "loaded");
        }, heading),
      { timeout: 30000, timeoutMsg: "the canvas never drew the heading with the downloaded font" },
    );
    const line = await canvasLine(heading);

    const output = join(workDir(), "Lora design.pdf");
    await button(t("studio.toolbar.export")).click();
    await $('[role="dialog"]').waitForDisplayed();
    await $(`//*[@role="dialog"]//*[@role="radio"][normalize-space(.)="${t("studio.export.formats.pdf")}"]`).click();
    answerDialogs(output);
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("tools.browse")}"]`).click();
    await waitForDialogsAnswered();
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("studio.export.run")}"]`).click();
    await waitForFile(output);

    const span = (probe(output).pages?.[0].spans ?? []).find((item) => item.text.trim() === heading);
    expect(span?.font).toContain("Lora");
    expect(Math.abs((span?.box[0] ?? 0) - line.left)).toBeLessThan(0.5);
    expect(Math.abs((span?.box[2] ?? 0) - line.right)).toBeLessThan(0.75);
  });

  it("finds a template in the Templates tab and adds it after the current page", async () => {
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("common.close")}"]`).click();
    await $('[role="dialog"]').waitForDisplayed({ reverse: true });
    const pages = () => $$(`[data-testid="studio-pages"] ol[aria-label="${t("studio.pages.label")}"] > li`);
    await $(`[data-studio-tab="templates"]`).click();
    await $(`input[aria-label="${t("studio.templates.search")}"]`).setValue(t("studio.templates.items.invoice"));
    await browser.waitUntil(async () => (await $$("[data-template]").length) === 1, { timeoutMsg: "the search did not narrow the gallery to the invoice" });
    const before = await pages().length;
    await $('[data-template="invoice"]').click();
    await browser.waitUntil(async () => (await elements().length) > 20, { timeout: 30000, timeoutMsg: "the invoice template did not fill the canvas" });
    await browser.waitUntil(async () => (await pages().length) === before + 1, { timeoutMsg: "the template was not added as a new page" });
    await expect($(`//*[@data-testid="studio-viewport"]//span[normalize-space(.)="${t("studio.tpl.clientName")}"]`)).toExist();
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "studio-template.png"));
  });

  it("fills a name from a CSV, previews each row and exports one signed PDF per row", async () => {
    const people = ["Ayşe Yılmaz", "Can Demir", "Elif Kaya"];
    const table = join(workDir(), "people.csv");
    writeFileSync(table, ["Name,Course", ...people.map((name) => `${name},Design`), ""].join("\r\n"), "utf8");
    const canvasHas = (text: string) => $(`//*[@data-testid="studio-viewport"]//*[@data-element-id][normalize-space(.)="${text}"]`);

    await $(`[data-studio-tab="data"]`).click();
    await browser.keys(ESCAPE);
    const before = await elements().length;
    answerDialogs(table);
    await $(`//button[.//span[normalize-space(.)="${t("studio.data.pick")}"]]`).click();
    await waitForDialogsAnswered();
    await expect($('[data-testid="studio-data-rows"]')).toHaveText(t("studio.data.rows", { count: 3 }));

    await $('[data-placeholder="Name"]').click();
    await browser.waitUntil(async () => (await elements().length) === before + 1, { timeoutMsg: "the column was not added as new text" });
    await canvasHas(people[0]).waitForExist({ timeout: 15000 });
    await $(`button[aria-label="${t("studio.data.next")}"]`).click();
    await canvasHas(people[1]).waitForExist();
    await expect($('[data-testid="studio-data-row"]')).toHaveText(t("studio.data.row", { row: 2, total: 3 }));

    const folder = join(workDir(), "certificates");
    await button(t("studio.toolbar.export")).click();
    await $('[role="dialog"]').waitForDisplayed();
    await $(`//*[@role="dialog"]//*[@role="radio"][normalize-space(.)="${t("studio.export.modes.split")}"]`).click();
    answerDialogs(folder);
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("tools.browse")}"]`).click();
    await waitForDialogsAnswered();
    await typeInto($('[data-testid="studio-export-pattern"]'), "{Name}");
    await $(`//*[@role="dialog"]//label[.//*[normalize-space(.)="${t("studio.export.signEach")}"]]`).click();
    answerDialogs(fixtures().signer);
    await $(`(//*[@role="dialog"]//button[normalize-space(.)="${t("tools.browse")}"])[2]`).click();
    await waitForDialogsAnswered();
    await typeInto($('//*[@role="dialog"]//input[@type="password"]'), "fixture-signer");
    await $(`//*[@role="dialog"]//button[normalize-space(.)="${t("studio.export.runRows", { count: 3 })}"]`).click();

    for (const name of people) {
      const output = join(folder, `${name}.pdf`);
      await waitForFile(output);
      const result = probe(output);
      expect(result.pages?.some((page) => page.text.replace(/\s+/g, " ").includes(name))).toBe(true);
      expect(result.signatures).toHaveLength(1);
      expect(result.signatures?.[0].intact).toBe(true);
    }
    await expect($(`//*[@role="dialog"]//*[normalize-space(.)="${t("studio.export.doneFiles", { count: 3 })}"]`)).toExist();
  });
});
