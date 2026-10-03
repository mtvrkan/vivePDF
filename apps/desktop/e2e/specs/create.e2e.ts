import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, chooseCard, clickDropArea, fill, openTool, outputPath, probe, runPrimary, t, typeInto, waitForDialogsAnswered, waitForOutputs, workDir } from "../support/app.ts";

async function chooseTable(path: string) {
  await openTool("nav.create");
  await $(`//*[@role="radio"][normalize-space(.)="${t("tools.create.tabs.bulk")}"]`).click();
  answerDialogs(path);
  const change = $(`//button[normalize-space(.)="${t("tools.create.change")}"]`);
  if (await change.isExisting()) await change.click();
  else await clickDropArea(t("tools.create.bulk.pickTitle"));
  await waitForDialogsAnswered();
  await $(`//span[@title="${path}"]`).waitForDisplayed({ timeout: 60000 });
}

async function chooseOutputIn(folder: string): Promise<string> {
  const suggested = await outputPath();
  const target = join(folder, basename(suggested));
  answerDialogs(target);
  await $(`//button[normalize-space(.)="${t("tools.browse")}"]`).click();
  await waitForDialogsAnswered();
  return suggested;
}

describe("create", () => {
  before(bootApp);

  it("lays out a plain text file as a petition with a heading, a list and a signature", async () => {
    const source = join(workDir(), "petition-source.txt");
    writeFileSync(source, ["KONU", "Dilekce metni burada yer alir.", "", "1. Birinci istek", "2. Ikinci istek", ""].join("\n"));
    await openTool("nav.create");
    answerDialogs(source);
    await clickDropArea(t("tools.create.pickTitle"));
    await waitForDialogsAnswered();
    await chooseCard(t("tools.create.templates.petition.title"));
    await fill(t("tools.create.fields.addressee"), "KAYMAKAMLIK MAKAMINA");
    await fill(t("tools.create.fields.signer"), "Ayse Demir");
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "create-page.png"));

    await runPrimary(t("tools.create.run"));
    const [output] = await waitForOutputs();

    const result = probe(output);
    expect(result.pageCount).toBe(1);
    const texts = (result.pages?.[0]?.spans ?? []).map((span) => span.text.trim());
    expect(texts).toEqual(expect.arrayContaining(["KAYMAKAMLIK MAKAMINA", "KONU", "Ayse Demir"]));
    const heading = result.pages?.[0]?.spans.find((span) => span.text.trim() === "KONU");
    const body = result.pages?.[0]?.spans.find((span) => span.text.includes("Dilekce metni"));
    expect(heading && body && heading.size > body.size).toBe(true);
  });

  it("makes a certificate for every row of a table and fills in the columns", async () => {
    const table = join(workDir(), "attendees.csv");
    writeFileSync(table, ["Ad,Kurs", "Ayşe Demir,Python", "Mehmet Kaya,Veri Bilimi", ""].join("\n"));
    await chooseTable(table);
    await $(`//button[normalize-space(.)="{Kurs}"]`).waitForClickable({ timeout: 60000 });
    await fill(t("tools.create.bulk.fields.body"), "has completed the course");
    await $(`//button[normalize-space(.)="{Kurs}"]`).click();
    await typeInto($(`input[aria-label="${t("tools.create.bulk.signerName")} 1"]`), "Prof. Selin Ak");
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "create-bulk.png"));

    await runPrimary(t("tools.create.bulk.run", { count: 2 }));
    const [output] = await waitForOutputs();

    const result = probe(output);
    expect(result.pageCount).toBe(2);
    const [first, second] = result.pages ?? [];
    expect(first.width).toBeGreaterThan(first.height);
    expect(first.text).toContain("Ayşe Demir");
    expect(first.text).toContain("has completed the course Python");
    expect(first.text).toContain("Prof. Selin Ak");
    expect(second.text).toContain("Mehmet Kaya");
    expect(second.text).toContain("Veri Bilimi");
  });

  it("saves one invitation per row named after a column", async () => {
    const table = join(workDir(), "guests.csv");
    writeFileSync(table, ["Ad,Masa", "Can Yilmaz,4", "Elif Su,7", ""].join("\n"));
    await chooseTable(table);
    await $(`//button[normalize-space(.)="{Masa}"]`).waitForClickable({ timeout: 60000 });
    await chooseCard(t("tools.create.bulk.kinds.invitation.title"));
    await fill(t("tools.create.bulk.fields.details"), "Table {Masa}");
    await $(`//*[@role="radio"][normalize-space(.)="${t("tools.create.bulk.outputModes.separate")}"]`).click();

    await runPrimary(t("tools.create.bulk.run", { count: 2 }));
    const outputs = await waitForOutputs();

    expect(outputs.map((path) => basename(path)).sort()).toEqual(["Can Yilmaz.pdf", "Elif Su.pdf"]);
    const folder = readdirSync(join(outputs[0], "..")).filter((name) => name.endsWith(".pdf"));
    expect(folder).toHaveLength(2);
    const elif = probe(outputs.find((path) => path.endsWith("Elif Su.pdf")) as string);
    expect(elif.pageCount).toBe(1);
    expect(elif.pages?.[0]?.text).toContain("Elif Su");
    expect(elif.pages?.[0]?.text).toContain("Table 7");
  });

  it("binds Markdown chapters into a book with a cover, contents and bookmarks", async () => {
    const folder = join(workDir(), "field-guide");
    mkdirSync(folder, { recursive: true });
    const paragraph = "Birds are best watched early in the morning. ".repeat(12);
    const first = join(folder, "01-start.md");
    const second = join(folder, "02-birds.md");
    writeFileSync(first, ["# Getting started", "", ...Array(10).fill(paragraph + "\n"), "## Kit list", "", paragraph, ""].join("\n"));
    writeFileSync(second, ["# Birds", "", paragraph, ""].join("\n"));
    await openTool("nav.create");
    await $(`//*[@role="radio"][normalize-space(.)="${t("tools.create.tabs.book")}"]`).click();
    answerDialogs([first, second]);
    await clickDropArea(t("tools.create.book.pickTitle"));
    await waitForDialogsAnswered();
    await $(`//li[contains(normalize-space(.), "02-birds.md")]`).waitForDisplayed({ timeout: 60000 });
    await fill(t("tools.create.fields.author"), "Deniz Kaya");
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "create-book.png"));

    await runPrimary(t("tools.create.book.run"));
    const [output] = await waitForOutputs();

    const result = probe(output);
    expect(basename(output)).toBe("field guide.pdf");
    const cover = (result.pages?.[0]?.text ?? "").normalize("NFKC");
    expect(cover).toContain("field guide");
    expect(cover).toContain("Deniz Kaya");
    expect(result.pages?.[1]?.text).toContain(t("tools.create.book.tocTitleDefault"));
    expect(result.pages?.[1]?.linkBoxes.length).toBeGreaterThanOrEqual(3);
    const outline = result.outline ?? [];
    expect(outline.map(([level, title]) => `${level} ${title}`)).toEqual(["1 Contents", "1 Getting started", "2 Kit list", "1 Birds"]);
    const birds = outline[3][2];
    expect(result.pages?.[birds - 1]?.text).toContain("Chapter 2");
    expect(result.pages?.[1]?.text).toContain(String(birds));
  });

  it("fills in a CV with the modern template and links the e-mail address", async () => {
    await openTool("nav.create");
    await $(`//*[@role="radio"][normalize-space(.)="${t("tools.create.tabs.cv")}"]`).click();
    await chooseCard(t("tools.create.cv.templates.modern.title"));
    await fill(t("tools.create.cv.fields.name"), "Deniz Kaya");
    await fill(t("tools.create.cv.fields.headline"), "Data Engineer");
    await fill(t("tools.create.cv.fields.contacts"), "deniz@example.com");
    await fill(t("tools.create.cv.fields.experience.title"), "Analyst");
    await fill(t("tools.create.cv.fields.experience.organisation"), "Acme");
    await fill(t("tools.create.cv.fields.skills"), "Python, SQL");
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "create-cv.png"));
    const suggested = await chooseOutputIn(workDir());

    await runPrimary(t("tools.create.cv.run"));
    const [output] = await waitForOutputs();

    const result = probe(output);
    expect(basename(suggested)).toBe("Deniz Kaya - CV.pdf");
    expect(output).toBe(join(workDir(), "Deniz Kaya - CV.pdf"));
    expect(result.pageCount).toBe(1);
    const text = (result.pages?.[0]?.text ?? "").normalize("NFKC");
    for (const expected of ["Deniz Kaya", "Data Engineer", "Analyst", "Acme", "Python", t("tools.create.cv.labels.experience"), t("tools.create.cv.labels.skills")]) expect(text).toContain(expected);
    expect(result.pages?.[0]?.links).toContain("mailto:deniz@example.com");
  });

  it("makes a dotted notebook with twenty pages", async () => {
    await openTool("nav.create");
    await $(`//*[@role="radio"][normalize-space(.)="${t("tools.create.tabs.paper")}"]`).click();
    await chooseCard(t("tools.pages.paper.dots"));
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "create-paper.png"));
    const suggested = await chooseOutputIn(workDir());

    await runPrimary(t("tools.create.paper.run"));
    const [output] = await waitForOutputs();

    const result = probe(output);
    expect(basename(suggested)).toBe("Dot grid.pdf");
    expect(output).toBe(join(workDir(), "Dot grid.pdf"));
    expect(result.pageCount).toBe(20);
    expect(result.pages?.[0]?.width).toBeLessThan(result.pages?.[0]?.height ?? 0);
  });
});
