import { readFileSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, chooseSource, clickDropArea, copyFixture, fixtures, openTool, outputPath, probe, runPrimary, setSwitch, t, waitForDialogsAnswered, waitForOutputs } from "../support/app.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(path: string, signature: number[]): boolean {
  const head = readFileSync(path).subarray(0, signature.length);
  return signature.every((byte, index) => head[index] === byte);
}

async function officeInstalled(): Promise<boolean> {
  return browser.executeAsync((done: (installed: boolean) => void) => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args: unknown) => Promise<T> } }).__TAURI_INTERNALS__;
    bridge.invoke<{ installed: boolean }>("rpc", { id: crypto.randomUUID(), method: "system.office_status", params: {} }).then(
      (status) => done(status.installed),
      () => done(false),
    );
  });
}

describe("convert", () => {
  before(bootApp);

  it("turns every PDF page into a picture", async () => {
    const source = copyFixture(fixtures().sample, "to-images.pdf");
    await openTool("tools.convert.modes.images");
    await chooseSource(source);
    await runPrimary(t("tools.convert.run"));
    const outputs = await waitForOutputs();
    expect(outputs).toHaveLength(3);
    for (const output of outputs) {
      expect(startsWith(output, PNG_SIGNATURE) || startsWith(output, JPEG_SIGNATURE)).toBe(true);
    }
  });

  it("turns every PDF page into its own SVG drawing", async () => {
    const source = copyFixture(fixtures().sample, "to-svg.pdf");
    await openTool("tools.convert.modes.svg");
    await chooseSource(source);

    await runPrimary(t("tools.convert.run"));

    const outputs = await waitForOutputs();
    expect(outputs).toHaveLength(3);
    for (const output of outputs) {
      expect(output.endsWith(".svg")).toBe(true);
      const drawing = readFileSync(output, "utf8");
      expect(drawing.startsWith("<svg")).toBe(true);
      expect(drawing).not.toContain("<text");
    }
  });

  it("turns two pictures into a two-page PDF", async () => {
    const red = copyFixture(fixtures().red);
    const blue = copyFixture(fixtures().blue);
    await openTool("tools.convert.modes.images-to-pdf");
    answerDialogs([red, blue]);
    await clickDropArea(t("tools.dropZone.images"));
    await waitForDialogsAnswered();
    const expected = await outputPath();
    await runPrimary(t("tools.convert.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    const result = probe(output);
    expect(result.pageCount).toBe(2);
    expect(result.pages?.map((page) => page.images)).toEqual([1, 1]);
  });

  it("turns two SVG drawings into one vector PDF with their text", async () => {
    const logo = copyFixture(fixtures().logo);
    const badge = copyFixture(fixtures().badge);
    await openTool("tools.convert.modes.svg-to-pdf");
    answerDialogs([logo, badge]);
    await clickDropArea(t("tools.dropZone.files"));
    await waitForDialogsAnswered();
    await setSwitch(t("tools.convert.combineSvg"), true);
    const expected = await outputPath();
    await runPrimary(t("tools.convert.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    const result = probe(output);
    expect(result.pageCount).toBe(2);
    expect(result.pages?.[0].text).toContain("Merhaba şğü");
    expect(result.pages?.[1].text).toContain("Badge");
    expect(result.pages?.map((page) => page.images)).toEqual([0, 0]);
    const [first, second] = result.pages ?? [];
    expect(first.width / first.height).toBeCloseTo(4 / 3, 1);
    expect(second.width / second.height).toBeCloseTo(1, 1);
  });

  it("turns a Word document with a Turkish name into a PDF with its text", async function () {
    if (!(await officeInstalled())) this.skip();
    const letter = copyFixture(fixtures().letter);
    await openTool("tools.convert.modes.file-to-pdf");
    answerDialogs([letter]);
    await clickDropArea(t("tools.dropZone.files"));
    await waitForDialogsAnswered();
    const expected = await outputPath();
    await runPrimary(t("tools.convert.run"));
    const [output] = await waitForOutputs(300000);
    expect(output).toBe(expected);
    const result = probe(output);
    expect(result.pageCount).toBe(1);
    expect(result.pages?.[0].text).toContain("Şirket mektubu");
    expect(result.pages?.[0].text).toContain("Merhaba dünya, ğüşiöç İĞÜŞÖÇ");
  });
});
