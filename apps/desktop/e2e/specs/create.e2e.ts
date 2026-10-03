import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, chooseCard, clickDropArea, fill, openTool, probe, runPrimary, t, waitForDialogsAnswered, waitForOutputs, workDir } from "../support/app.ts";

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
});
