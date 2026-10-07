import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, button, chooseSource, clickButton, closeAllDocuments, copyFixture, fill, fixtures, openInViewer, openTool, outputPath, probe, runPrimary, t, typeInto, waitForDialogsAnswered, waitForFile, waitForOutputs, workDir } from "../support/app.ts";
import { pagePoint } from "../support/desktop.ts";

async function chooseEditorItem(menuKey: "viewer.overlay.insert" | "viewer.overlay.moreTools", itemKey: string) {
  const trigger = $(`//*[@data-overlay-bar]//button[normalize-space(.)="${t(menuKey)}"]`);
  if (!(await trigger.isDisplayed())) await clickButton(t("viewer.overlay.editMenu"));
  await trigger.waitForClickable();
  await trigger.click();
  const item = $(`//*[@role="menu"]//button[normalize-space(.)="${t(itemKey)}"]`);
  await item.waitForClickable();
  await item.click();
}

const TURKISH_NAME = "Çağla Şüküroğlu İğdır Işık";

describe("edit", () => {
  before(bootApp);

  it("fills a form field with Turkish text", async () => {
    const source = copyFixture(fixtures().form, "form-fill.pdf");
    await openTool("tools.forms.tabs.fill");
    await chooseSource(source);
    await fill("fullName", TURKISH_NAME);
    const expected = await outputPath();
    await runPrimary(t("tools.forms.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    expect(probe(output).fields?.fullName).toBe(TURKISH_NAME);
    expect(probe(source).fields?.fullName).toBe("");
  });

  it("finds and replaces text on every page", async () => {
    const source = copyFixture(fixtures().sample, "find-replace.pdf");
    await openTool("tools.edit.findReplace.title");
    await chooseSource(source);
    await fill(t("tools.edit.findReplace.find"), "alpha marker");
    await fill(t("tools.edit.findReplace.replace"), "omega marker");
    const expected = await outputPath();
    await runPrimary(t("tools.edit.findReplace.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    const result = probe(output);
    expect(result.pageCount).toBe(3);
    result.pages?.forEach((page, index) => {
      expect(page.text).toContain(`omega marker ${index + 1}`);
      expect(page.text).not.toContain("alpha marker");
      expect(page.text).toContain(`Sample page ${index + 1}`);
    });
  });

  it("types a formula, places it on the page and saves it as vector drawing", async () => {
    const source = copyFixture(fixtures().sample, "formula.pdf");
    const before = probe(source);
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.formula.menu");
    const area = $('[role="dialog"] textarea');
    await area.waitForDisplayed();
    const latex = String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`;
    await typeInto(area, latex);
    await $(`//div[@role="dialog"]//img[@alt='${latex}']`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "formula-dialog.png"));
    await clickButton(t("viewer.formula.insert"));
    await area.waitForExist({ reverse: true });

    const point = await pagePoint(0, 300, 420);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(point).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });
    await browser.saveScreenshot(join(workDir(), "formula-placed.png"));

    const output = join(workDir(), "formula-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].drawings ?? 0) > (before.pages?.[0].drawings ?? 0) + 5, {
      timeout: 30000,
      timeoutMsg: "the saved copy has no formula drawing on page 1",
    });
    const saved = probe(output);
    expect(saved.pageCount).toBe(3);
    expect(saved.pages?.[0].images).toBe(before.pages?.[0].images);
    expect(saved.pages?.[0].text).toContain("Sample page 1");
    expect(saved.pages?.[1].drawings).toBe(before.pages?.[1].drawings);
    expect(probe(source).pages?.[0].drawings).toBe(before.pages?.[0].drawings);
  });

  it("picks a solid from the shape library, places it on the page and saves it as vector drawing", async () => {
    const source = copyFixture(fixtures().sample, "shape.pdf");
    const before = probe(source);
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.shapes.menu");
    const dialog = $(`//div[@role="dialog"][.//h2[normalize-space(.)="${t("viewer.shapes.title")}"]]`);
    await dialog.waitForDisplayed();
    await $(`//div[@role="dialog"]//button[@role="radio"][normalize-space(.)="${t("viewer.shapes.groups.solids")}"]`).click();
    await $(`//div[@role="dialog"]//button[@role="radio"][@title="${t("viewer.shapes.names.cone")}"]`).click();
    await $(`//div[@role="dialog"]//div[@role="img"][@aria-label="${t("viewer.shapes.names.cone")}"][@aria-busy="false"]`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "shape-dialog.png"));
    await clickButton(t("viewer.shapes.insert"));
    await dialog.waitForExist({ reverse: true, timeout: 30000 });

    const point = await pagePoint(0, 300, 420);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(point).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });
    await browser.saveScreenshot(join(workDir(), "shape-placed.png"));

    const output = join(workDir(), "shape-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].drawings ?? 0) > (before.pages?.[0].drawings ?? 0) + 3, {
      timeout: 30000,
      timeoutMsg: "the saved copy has no shape drawing on page 1",
    });
    const saved = probe(output);
    expect(saved.pageCount).toBe(3);
    expect(saved.pages?.[0].images).toBe(before.pages?.[0].images);
    expect(saved.pages?.[0].text).toContain("Sample page 1");
    expect(saved.pages?.[1].drawings).toBe(before.pages?.[1].drawings);
    expect(probe(source).pages?.[0].drawings).toBe(before.pages?.[0].drawings);
  });

  it("plots a typed function, places the graph on the page and saves it as vector drawing", async () => {
    const source = copyFixture(fixtures().sample, "graph.pdf");
    const before = probe(source);
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.graph.menu");
    const input = $(`[role="dialog"] input[aria-label="${t("viewer.graph.functionLabel", { name: "f" })}"]`);
    await input.waitForDisplayed();
    await typeInto(input, "x^3 - 3x");
    await $(`[role="dialog"] [role="img"][aria-label="${t("viewer.graph.previewLabel")}"][aria-busy="false"]`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "graph-dialog.png"));
    await clickButton(t("viewer.graph.insert"));
    await input.waitForExist({ reverse: true, timeout: 30000 });

    const point = await pagePoint(0, 300, 420);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(point).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });
    await browser.saveScreenshot(join(workDir(), "graph-placed.png"));

    const output = join(workDir(), "graph-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].drawings ?? 0) > (before.pages?.[0].drawings ?? 0) + 20, {
      timeout: 30000,
      timeoutMsg: "the saved copy has no graph drawing on page 1",
    });
    const saved = probe(output);
    expect(saved.pageCount).toBe(3);
    expect(saved.pages?.[0].images).toBe(before.pages?.[0].images);
    expect(saved.pages?.[0].text).toContain("Sample page 1");
    expect(saved.pages?.[1].drawings).toBe(before.pages?.[1].drawings);
    expect(probe(source).pages?.[0].drawings).toBe(before.pages?.[0].drawings);
  });

  it("builds a table from typed cells, places it and saves it as real, searchable text", async () => {
    const source = copyFixture(fixtures().sample, "table.pdf");
    const before = probe(source);
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.table.menu");
    const cell = (row: number, column: number) => $(`[role="dialog"] input[aria-label="${t("viewer.grid.cellLabel", { row, column })}"]`);
    await cell(1, 1).waitForDisplayed();
    await typeInto(cell(1, 1), "Ürün");
    await typeInto(cell(1, 2), "Fiyat");
    await typeInto(cell(2, 1), "Çay");
    await typeInto(cell(2, 2), "15,50");
    await $(`[role="dialog"] [role="img"][aria-label="${t("viewer.table.previewLabel")}"] img`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "table-dialog.png"));
    await clickButton(t("viewer.table.insert"));
    await cell(1, 1).waitForExist({ reverse: true, timeout: 30000 });

    const point = await pagePoint(0, 300, 420);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(point).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });
    await browser.saveScreenshot(join(workDir(), "table-placed.png"));

    const output = join(workDir(), "table-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].text ?? "").includes("15,50"), {
      timeout: 30000,
      timeoutMsg: "the saved copy has no table text on page 1",
    });
    const saved = probe(output);
    expect(saved.pageCount).toBe(3);
    expect(saved.pages?.[0].text).toContain("Ürün");
    expect(saved.pages?.[0].text).toContain("Sample page 1");
    expect(saved.pages?.[0].images).toBe(before.pages?.[0].images);
    expect(saved.pages?.[0].drawings).toBeGreaterThan(before.pages?.[0].drawings ?? 0);
    expect(probe(source).pages?.[0].text).not.toContain("Ürün");
  });

  it("writes a multiple-choice question and its answer key and saves both as real text", async () => {
    const source = copyFixture(fixtures().sample, "question.pdf");
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.question.menu");
    const stem = $(`//div[@role="dialog"]//label[span[normalize-space(.)="${t("viewer.question.stem")}"]]//textarea`);
    await stem.waitForDisplayed();
    await typeInto(stem, "Türkiye'nin başkenti hangisidir?");
    const option = (letter: string) => $(`[role="dialog"] input[aria-label="${t("viewer.question.optionLabel", { letter })}"]`);
    await typeInto(option("A"), "İstanbul");
    await typeInto(option("B"), "Ankara");
    await typeInto(option("C"), "İzmir");
    await typeInto(option("D"), "Bursa");
    await clickButton(t("viewer.question.markCorrect", { letter: "B" }));
    await expect($(`[role="dialog"] [role="radio"][aria-label="${t("viewer.question.markCorrect", { letter: "B" })}"]`)).toHaveAttribute("aria-checked", "true");
    await $(`[role="dialog"] [role="img"][aria-label="${t("viewer.question.previewLabel")}"] img`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "question-dialog.png"));
    await clickButton(t("viewer.question.insert"));
    await stem.waitForExist({ reverse: true, timeout: 30000 });
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(await pagePoint(0, 300, 250)).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });

    await chooseEditorItem("viewer.overlay.insert", "viewer.answerKey.menu");
    const cell = (row: number, column: number) => $(`[role="dialog"] input[aria-label="${t("viewer.grid.cellLabel", { row, column })}"]`);
    await cell(1, 1).waitForDisplayed();
    await expect(cell(1, 1)).toHaveValue("1");
    await expect(cell(1, 2)).toHaveValue("B");
    await $(`[role="dialog"] [role="img"][aria-label="${t("viewer.answerKey.previewLabel")}"] img`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "answer-key-dialog.png"));
    await clickButton(t("viewer.answerKey.insert"));
    await cell(1, 1).waitForExist({ reverse: true, timeout: 30000 });
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(await pagePoint(0, 300, 640)).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 2 })}"]`).waitForDisplayed({ timeout: 10000 });
    await browser.saveScreenshot(join(workDir(), "question-placed.png"));

    const output = join(workDir(), "question-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].text ?? "").includes("Ankara"), {
      timeout: 30000,
      timeoutMsg: "the saved copy has no question text on page 1",
    });
    const text = probe(output).pages?.[0].text ?? "";
    for (const word of ["1.", "başkenti", "A)", "İstanbul", "D)", "Bursa", t("viewer.answerKey.answerHeader"), "Sample page 1"]) expect(text).toContain(word);
    expect(probe(source).pages?.[0].text).not.toContain("Ankara");
  });

  it("draws a chart from the data grid, places it and saves its labels as real text", async () => {
    const source = copyFixture(fixtures().sample, "chart.pdf");
    const before = probe(source);
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.chart.menu");
    const cell = (row: number, column: number) => $(`[role="dialog"] input[aria-label="${t("viewer.grid.cellLabel", { row, column })}"]`);
    await cell(2, 1).waitForDisplayed();
    await typeInto(cell(2, 1), "Çay");
    await typeInto($(`//div[@role="dialog"]//label[span[normalize-space(.)="${t("viewer.chart.chartTitle")}"]]//input`), "Aylık satış");
    await clickButton(t("viewer.chart.types.bar"));
    await $(`[role="dialog"] [role="img"][aria-label="${t("viewer.chart.previewLabel")}"] img`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "chart-dialog.png"));
    await clickButton(t("viewer.chart.insert"));
    await cell(2, 1).waitForExist({ reverse: true, timeout: 30000 });

    const point = await pagePoint(0, 300, 420);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(point).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });
    await browser.saveScreenshot(join(workDir(), "chart-placed.png"));

    const output = join(workDir(), "chart-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].text ?? "").includes("Aylık satış"), {
      timeout: 30000,
      timeoutMsg: "the saved copy has no chart text on page 1",
    });
    const saved = probe(output);
    expect(saved.pages?.[0].text).toContain("Çay");
    expect(saved.pages?.[0].text).toContain(t("viewer.chart.sample.series", { number: 1 }));
    expect(saved.pages?.[0].text).toContain("Sample page 1");
    expect(saved.pages?.[0].images).toBe(before.pages?.[0].images);
    expect(saved.pages?.[0].drawings).toBeGreaterThan(before.pages?.[0].drawings ?? 0);
  });

  it("turns the sample data into a histogram with its bin edges saved as text", async () => {
    const source = copyFixture(fixtures().sample, "histogram.pdf");
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.chart.menu");
    await $(`//div[@role="dialog"]//*[@role="radio"][normalize-space(.)="${t("viewer.chart.types.histogram")}"]`).click();
    await expect($(`//div[@role="dialog"]//*[@role="radio"][normalize-space(.)="${t("viewer.chart.types.histogram")}"]`)).toHaveAttribute("aria-checked", "true");
    await expect($(`//div[@role="dialog"]//*[normalize-space(.)="${t("viewer.chart.dataHintSamples")}"]`)).toBeDisplayed();
    await $(`[role="dialog"] [role="img"][aria-label="${t("viewer.chart.previewLabel")}"]:not([aria-busy]) img`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "histogram-dialog.png"));
    await clickButton(t("viewer.chart.insert"));
    await $(`[role="dialog"] [role="img"][aria-label="${t("viewer.chart.previewLabel")}"]`).waitForExist({ reverse: true, timeout: 30000 });
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(await pagePoint(0, 300, 420)).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });

    const output = join(workDir(), "histogram-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].text ?? "").includes(t("viewer.chart.sample.series", { number: 2 })), {
      timeout: 30000,
      timeoutMsg: "the saved copy has no histogram text on page 1",
    });
    const words = (probe(output).pages?.[0].text ?? "").split(/\s+/);
    for (const edge of ["2", "4", "6", "8"]) expect(words).toContain(edge);
  });

  it("lays out a flowchart from its steps and saves the step texts as real text", async () => {
    const source = copyFixture(fixtures().sample, "flowchart.pdf");
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.flowchart.menu");
    const stepText = (number: number) => $(`[role="dialog"] input[aria-label="${t("viewer.flowchart.stepText", { number })}"]`);
    await stepText(1).waitForDisplayed();
    await expect(stepText(1)).toHaveValue(t("viewer.flowchart.sample.start"));
    await clickButton(t("viewer.flowchart.addStep"));
    await typeInto(stepText(4), "Sonucu yazdır");
    await expect($(`[role="dialog"] input[aria-label="${t("viewer.flowchart.arrowLabel", { number: 3 })}"]`)).toBeDisplayed();
    await $(`[role="dialog"] [role="img"][aria-label="${t("viewer.flowchart.previewLabel")}"]:not([aria-busy]) img`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "flowchart-dialog.png"));
    await clickButton(t("viewer.flowchart.insert"));
    await stepText(1).waitForExist({ reverse: true, timeout: 30000 });
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(await pagePoint(0, 300, 420)).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });
    await browser.saveScreenshot(join(workDir(), "flowchart-placed.png"));

    const output = join(workDir(), "flowchart-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].text ?? "").includes("Sonucu"), {
      timeout: 30000,
      timeoutMsg: "the saved copy has no flowchart text on page 1",
    });
    const text = probe(output).pages?.[0].text ?? "";
    for (const word of [t("viewer.flowchart.sample.start"), t("viewer.flowchart.sample.end"), "yazdır", "Sample page 1"]) expect(text).toContain(word);
  });

  it("draws a molecule from SMILES and saves its atom labels as real text", async () => {
    const source = copyFixture(fixtures().sample, "molecule.pdf");
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.molecule.menu");
    const smiles = $(`[role="dialog"] input[dir="ltr"]`);
    await smiles.waitForDisplayed();
    await clickButton(t("viewer.molecule.names.aspirin"));
    await $(`[role="dialog"] [role="status"] img[alt="${t("viewer.molecule.previewAlt", { smiles: "CC(=O)Oc1ccccc1C(=O)O" })}"]`).waitForDisplayed({ timeout: 30000 });
    await typeInto(smiles, "CC(C)(C)[Si](C)(C)Cl");
    await $(`[role="dialog"] [role="status"] img[alt="${t("viewer.molecule.previewAlt", { smiles: "CC(C)(C)[Si](C)(C)Cl" })}"]`).waitForDisplayed({ timeout: 30000 });
    await browser.saveScreenshot(join(workDir(), "molecule-dialog.png"));
    await clickButton(t("viewer.molecule.insert"));
    await smiles.waitForExist({ reverse: true, timeout: 30000 });
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(await pagePoint(0, 300, 420)).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });
    await browser.saveScreenshot(join(workDir(), "molecule-placed.png"));

    const output = join(workDir(), "molecule-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].text ?? "").includes("Si"), {
      timeout: 30000,
      timeoutMsg: "the saved copy has no molecule labels on page 1",
    });
    const text = probe(output).pages?.[0].text ?? "";
    for (const word of ["Si", "Cl", "Sample page 1"]) expect(text).toContain(word);
  });

  it("tags a drawing placed in a tagged PDF as a figure with a written description", async () => {
    const source = copyFixture(fixtures().tagged, "tagged-figure.pdf");
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.molecule.menu");
    await clickButton(t("viewer.molecule.names.ethanol"));
    await $(`[role="dialog"] [role="status"] img[alt="${t("viewer.molecule.previewAlt", { smiles: "CCO" })}"]`).waitForDisplayed({ timeout: 30000 });
    await clickButton(t("viewer.molecule.insert"));
    await $(`[role="dialog"]`).waitForExist({ reverse: true, timeout: 30000 });
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(await pagePoint(0, 300, 420)).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });

    const output = join(workDir(), "tagged-figure-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).figureAlts ?? []).length > 0, { timeout: 30000, timeoutMsg: "the saved copy has no figure element" });
    expect(probe(output).figureAlts).toContain(t("viewer.altText.molecule", { smiles: "CCO" }));
  });

  it("tags a picture placed in a tagged PDF with the alt text typed for it", async () => {
    const source = copyFixture(fixtures().tagged, "tagged-picture.pdf");
    const picture = copyFixture(fixtures().red, "red-banner.png");
    await closeAllDocuments();
    await openInViewer(source);
    answerDialogs(picture);
    await chooseEditorItem("viewer.overlay.insert", "viewer.overlay.image");
    await waitForDialogsAnswered();
    await $(`//*[normalize-space(.)="${t("viewer.overlay.imageHint")}"]`).waitForDisplayed({ timeout: 30000 });
    const spot = await pagePoint(0, 300, 420);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(spot).down().up().perform();
    await $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count: 1 })}"]`).waitForDisplayed({ timeout: 10000 });

    const altButton = button(t("viewer.overlay.altText"));
    if (!(await altButton.isDisplayed())) await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(spot).down().up().perform();
    await clickButton(t("viewer.overlay.altText"));
    await typeInto($(`//*[@role="dialog"][p[normalize-space(.)="${t("viewer.overlay.altText")}"]]//textarea`), "Red banner with the word RED");

    const output = join(workDir(), "tagged-picture-saved.pdf");
    answerDialogs(output);
    await clickButton(t("viewer.overlay.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).figureAlts ?? []).length > 0, { timeout: 30000, timeoutMsg: "the saved copy has no figure element" });
    expect(probe(output).figureAlts).toEqual(["Red banner with the word RED"]);
  });
});

