import { readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, chooseCard, clickDropArea, fill, openTool, probe, runPrimary, t, typeInto, waitForDialogsAnswered, waitForOutputs, workDir } from "../support/app.ts";

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
});
