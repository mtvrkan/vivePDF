import { expect } from "@wdio/globals";
import { bootApp, chooseSource, copyFixture, fixtures, openTool, outputPath, probe, runPrimary, t, waitForOutputs } from "../support/app.ts";

describe("features", () => {
  before(bootApp);

  it("tiles every page across a 2×2 grid of A4 sheets", async () => {
    const source = copyFixture(fixtures().sample, "poster.pdf");
    await openTool("tools.edit.poster.title");
    await chooseSource(source);
    const expected = await outputPath();
    await runPrimary(t("tools.edit.poster.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    const result = probe(output);
    expect(result.pageCount).toBe(12);
    result.pages?.forEach((page) => {
      expect(Math.min(page.width, page.height)).toBeCloseTo(595, 0);
      expect(Math.max(page.width, page.height)).toBeCloseTo(842, 0);
    });
    expect(result.pages?.[0].text).toContain("Sample page 1");
  });

  it("turns web and e-mail addresses into links", async () => {
    const source = copyFixture(fixtures().contacts, "autolink.pdf");
    await openTool("tools.edit.autolink.title");
    await chooseSource(source);
    const expected = await outputPath();
    await runPrimary(t("tools.edit.autolink.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    const links = probe(output).pages?.[0].links ?? [];
    expect(links).toContain("https://vivepdf.example/docs");
    expect(links).toContain("mailto:help@vivepdf.example");
    expect(probe(source).pages?.[0].links).toEqual([]);
  });

  it("saves a PDF/A-2b copy that keeps the text", async () => {
    const source = copyFixture(fixtures().sample, "archive.pdf");
    await openTool("nav.pdfa");
    await chooseSource(source);
    const expected = await outputPath();
    await runPrimary(t("tools.pdfa.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    const result = probe(output);
    expect(result.pdfaPart).toBe("2");
    expect(result.pageCount).toBe(3);
    expect(result.pages?.[2].text).toContain("alpha marker 3");
    expect(probe(source).pdfaPart).toBeNull();
  });
});
