import { statSync } from "node:fs";
import { expect } from "@wdio/globals";
import { bootApp, chooseSource, copyFixture, fixtures, openTool, outputPath, probe, runPrimary, setSwitch, t, waitForOutputs } from "../support/app.ts";

describe("optimize", () => {
  before(bootApp);

  it("compresses a scanned page into a smaller valid file", async () => {
    const source = copyFixture(fixtures().scanned, "compress-me.pdf");
    await openTool("nav.compress");
    await chooseSource(source);
    const expected = await outputPath();
    await runPrimary(t("tools.compress.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    expect(statSync(output).size).toBeLessThan(statSync(source).size);
    const result = probe(output);
    expect(result.pageCount).toBe(1);
    expect(result.pages?.[0].images).toBe(1);
  });

  it("recognises Turkish and English text on a scanned page", async () => {
    const source = copyFixture(fixtures().scanned, "ocr-me.pdf");
    expect(probe(source).pages?.[0].text.trim()).toBe("");
    await openTool("nav.ocr");
    await chooseSource(source);
    await setSwitch(new Intl.DisplayNames(["en"], { type: "language" }).of("tr") as string, true);
    await setSwitch("English", true);
    const expected = await outputPath();
    await runPrimary(t("tools.ocr.run"));
    const [output] = await waitForOutputs(240000);
    expect(output).toBe(expected);
    const text = (probe(output).pages?.[0].text ?? "").replace(/\s+/g, " ");
    expect(text).toContain("INVOICE NUMBER 4821");
    expect(text).toContain("Merhaba");
    expect(text).toContain("OPTICAL TEXT CHECK");
  });
});
