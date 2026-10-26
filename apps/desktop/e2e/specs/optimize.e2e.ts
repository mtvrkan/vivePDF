import { statSync } from "node:fs";
import { expect } from "@wdio/globals";
import { bootApp, chooseSource, copyFixture, fixtures, openTool, outputPath, probe, runPrimary, setSwitch, t, typeInto, waitForOutputs } from "../support/app.ts";

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

  it("checks a thesis against the left 4 cm rules and passes the left margin once it is set to 20 mm", async () => {
    const source = copyFixture(fixtures().sample, "thesis-check.pdf");
    await openTool("nav.thesisCheck");
    await chooseSource(source);
    await $('[data-thesis-check="marginLeft"]').waitForDisplayed({ timeout: 60000 });
    await expect($('[data-thesis-check="text"]')).toHaveAttribute("data-status", "pass");
    await expect($('[data-thesis-check="paper"]')).toHaveAttribute("data-status", "pass");
    await expect($('[data-thesis-check="marginLeft"]')).toHaveAttribute("data-status", "fail");
    await typeInto($("[data-thesis-margin=left]"), "20");
    await browser.waitUntil(async () => (await $('[data-thesis-check="marginLeft"]').getAttribute("data-status")) === "pass", {
      timeout: 60000,
      timeoutMsg: "the left margin did not pass after lowering the rule to 20 mm",
    });
    await expect($(`//*[@role="radio"][contains(normalize-space(.), "${t("tools.thesisCheck.presets.custom.title")}")]`)).toHaveAttribute("aria-checked", "true");
  });
});
