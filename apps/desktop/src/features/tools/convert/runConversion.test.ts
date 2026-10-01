import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcProgress } from "@/types";

const invoke = vi.fn();
const fileToPdf = vi.fn();
const svgToPdf = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const convertToXlsx = vi.fn();
const convertToDocx = vi.fn();
const convertToImages = vi.fn();
const convertToText = vi.fn();
const convertToMarkdown = vi.fn();
const extractImages = vi.fn();
vi.mock("@/shared/rpc/operations", () => ({
  fileToPdf: (...args: unknown[]) => fileToPdf(...args),
  svgToPdf: (...args: unknown[]) => svgToPdf(...args),
  convertToXlsx: (...args: unknown[]) => convertToXlsx(...args),
  convertToDocx: (...args: unknown[]) => convertToDocx(...args),
  convertToImages: (...args: unknown[]) => convertToImages(...args),
  convertToText: (...args: unknown[]) => convertToText(...args),
  convertToMarkdown: (...args: unknown[]) => convertToMarkdown(...args),
  extractImages: (...args: unknown[]) => extractImages(...args),
}));

import { runConversion, type ConvertRun } from "./runConversion";

function batch(files: string[], overwrite = false): ConvertRun {
  return { mode: "file-to-pdf", output: "", outputDir: "C:\\out", overwrite, options: { files, paper: "a4" } as ConvertRun["options"] };
}

function converted(params: { output: string }) {
  return Promise.resolve({ output: params.output, bytes: 10, pageCount: 2 });
}

describe("runConversion file-to-pdf batches", () => {
  beforeEach(() => {
    invoke.mockReset();
    fileToPdf.mockReset();
    invoke.mockImplementation(async (_command: string, args: { paths: string[] }) => args.paths.map(() => false));
  });

  it("keeps going past a file that fails and reports it with its reason", async () => {
    fileToPdf.mockImplementation((params: { path: string; output: string }) =>
      params.path.endsWith("broken.docx") ? Promise.reject({ code: "INVALID_PARAMS", message: "x", data: { reason: "officeUnreadable" } }) : converted(params),
    );
    const outcome = await runConversion(batch(["C:\\in\\a.docx", "C:\\in\\broken.docx", "C:\\in\\c.xlsx"]), {});
    expect(outcome.outputs).toEqual(["C:\\out\\a.pdf", "C:\\out\\c.pdf"]);
    expect(outcome.count).toBe(4);
    expect(outcome.failed).toEqual([{ path: "C:\\in\\broken.docx", error: { code: "INVALID_PARAMS", message: "x", data: { reason: "officeUnreadable" } } }]);
  });

  it("gives files with the same name from different folders their own PDF", async () => {
    fileToPdf.mockImplementation(converted);
    const outcome = await runConversion(batch(["C:\\a\\r.docx", "C:\\b\\r.docx"]), {});
    expect(outcome.outputs).toEqual(["C:\\out\\r-docx.pdf", "C:\\out\\r-docx (2).pdf"]);
  });

  it("scales each file's progress into the whole batch", async () => {
    fileToPdf.mockImplementation((params: { output: string }, options: { onProgress?: (update: RpcProgress) => void }) => {
      options.onProgress?.({ id: "x", progress: 0.5 });
      return converted(params);
    });
    const seen: number[] = [];
    await runConversion(batch(["C:\\in\\a.docx", "C:\\in\\b.docx"]), { onProgress: (update) => seen.push(update.progress) });
    expect(seen).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it("asks about an existing PDF before converting anything", async () => {
    invoke.mockImplementation(async (_command: string, args: { paths: string[] }) => args.paths.map((path) => path.endsWith("b.pdf")));
    await expect(runConversion(batch(["C:\\in\\a.docx", "C:\\in\\b.docx"]), {})).rejects.toMatchObject({ data: { exists: true, path: "C:\\out\\b.pdf" } });
    expect(fileToPdf).not.toHaveBeenCalled();
  });

  it("stops the whole batch when it is cancelled", async () => {
    fileToPdf.mockRejectedValueOnce({ code: "CANCELLED", message: "stop" }).mockImplementation(converted);
    await expect(runConversion(batch(["C:\\in\\a.docx", "C:\\in\\b.docx"]), {})).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fileToPdf).toHaveBeenCalledTimes(1);
  });

  it("fails with the first reason when no file could be converted", async () => {
    fileToPdf.mockRejectedValue({ code: "INVALID_PARAMS", message: "x", data: { reason: "unsupportedType" } });
    await expect(runConversion(batch(["C:\\in\\a.xyz", "C:\\in\\b.xyz"]), {})).rejects.toMatchObject({ data: { reason: "unsupportedType" } });
  });
});

function fromPdf(mode: "xlsx" | "docx"): ConvertRun {
  return {
    mode,
    source: { path: "C:/in/a.pdf" },
    output: `C:/out/a.${mode}`,
    sheetLabels: { pageLabel: "S", tableLabel: "T", textLabel: "Metin" },
    options: { sheets: "table", xlsxFormat: "xlsx", borderless: false } as ConvertRun["options"],
  };
}

describe("runConversion svg-to-pdf", () => {
  function svgRun(svgFiles: string[], combineSvg: boolean): ConvertRun {
    return { mode: "svg-to-pdf", output: "C:\\out\\logo.pdf", outputDir: "C:\\out", options: { svgFiles, combineSvg, paper: "a4" } as ConvertRun["options"] };
  }

  beforeEach(() => {
    invoke.mockReset();
    fileToPdf.mockReset();
    svgToPdf.mockReset();
    invoke.mockImplementation(async (_command: string, args: { paths: string[] }) => args.paths.map(() => false));
  });

  it("writes one PDF for a single drawing or when the drawings are combined", async () => {
    svgToPdf.mockResolvedValue({ output: "C:\\out\\logo.pdf", bytes: 20, pageCount: 2 });
    const outcome = await runConversion(svgRun(["C:\\in\\a.svg", "C:\\in\\b.svg"], true), {});
    expect(svgToPdf.mock.calls[0][0]).toEqual({ paths: ["C:\\in\\a.svg", "C:\\in\\b.svg"], output: "C:\\out\\logo.pdf", overwrite: undefined });
    expect(outcome).toMatchObject({ outputs: ["C:\\out\\logo.pdf"], count: 2, label: "pages" });
    await runConversion(svgRun(["C:\\in\\a.svg"], false), {});
    expect(svgToPdf).toHaveBeenCalledTimes(2);
    expect(fileToPdf).not.toHaveBeenCalled();
  });

  it("gives each drawing its own PDF when they are not combined", async () => {
    fileToPdf.mockImplementation(converted);
    const outcome = await runConversion(svgRun(["C:\\in\\a.svg", "C:\\in\\b.svg"], false), {});
    expect(svgToPdf).not.toHaveBeenCalled();
    expect(outcome.outputs).toEqual(["C:\\out\\a.pdf", "C:\\out\\b.pdf"]);
  });
});

describe("runConversion office results", () => {
  beforeEach(() => {
    convertToXlsx.mockReset();
    convertToDocx.mockReset();
  });

  it("passes the sheet names and reports pages written as text", async () => {
    convertToXlsx.mockResolvedValue({ output: "C:/out/a.xlsx", bytes: 5, tableCount: 2, textPages: [3], textlessPages: [4] });
    const outcome = await runConversion(fromPdf("xlsx"), {});
    expect(convertToXlsx.mock.calls[0][0]).toMatchObject({ pageLabel: "S", tableLabel: "T", textLabel: "Metin" });
    expect(outcome).toMatchObject({ count: 2, noTables: false, textPages: [3], textless: { pages: [4], key: "textlessOffice" } });
  });

  it("says when no table was found and every page went in as text", async () => {
    convertToXlsx.mockResolvedValue({ output: "C:/out/a.xlsx", bytes: 5, tableCount: 0, textPages: [1, 2], textlessPages: [] });
    const outcome = await runConversion(fromPdf("xlsx"), {});
    expect(outcome).toMatchObject({ noTables: true, textPages: [] });
    expect(outcome.textless).toBeUndefined();
  });

  it("reports Word pages that could not be written", async () => {
    convertToDocx.mockResolvedValue({ output: "C:/out/a.docx", bytes: 5, skippedPages: [2], textlessPages: [] });
    const outcome = await runConversion(fromPdf("docx"), {});
    expect(outcome).toMatchObject({ skippedPages: [2] });
    expect(outcome.textless).toBeUndefined();
  });

  it("passes the header and footer choice and says when they moved", async () => {
    convertToDocx.mockResolvedValue({ output: "C:/out/a.docx", bytes: 5, skippedPages: [], textlessPages: [], headerLines: 1, footerLines: 0 });
    const run = fromPdf("docx");
    run.options = { ...run.options, headerFooter: false };
    expect(await runConversion(run, {})).toMatchObject({ headerFooterMoved: true });
    expect(convertToDocx.mock.calls[0][0]).toMatchObject({ headerFooter: false });
    convertToDocx.mockResolvedValue({ output: "C:/out/a.docx", bytes: 5, skippedPages: [], textlessPages: [], headerLines: 0, footerLines: 0 });
    expect(await runConversion(run, {})).toMatchObject({ headerFooterMoved: false });
  });
});

function pdfTo(mode: "images" | "extract-images" | "text" | "markdown"): ConvertRun {
  return {
    mode,
    source: { path: "C:/in/a.pdf" },
    output: "C:/out/a.txt",
    outputDir: "C:/out",
    options: { format: "png", dpi: 600, quality: 90, single: false, transparent: false, layout: true } as ConvertRun["options"],
  };
}

describe("runConversion picture and text results", () => {
  beforeEach(() => {
    convertToImages.mockReset();
    convertToText.mockReset();
    convertToMarkdown.mockReset();
    extractImages.mockReset();
  });

  it("reports pages saved at a lower resolution", async () => {
    convertToImages.mockResolvedValue({ outputs: ["C:/out/a-1.png", "C:/out/a-2.png"], bytes: 9, reducedPages: [2] });
    const outcome = await runConversion(pdfTo("images"), {});
    expect(outcome).toMatchObject({ count: 2, reducedPages: [2] });
  });

  it("counts the pages inside a ZIP and never asks a single image for one", async () => {
    convertToImages.mockResolvedValue({ outputs: ["C:/out/a.zip"], bytes: 9, reducedPages: [], pageCount: 7 });
    const archived = pdfTo("images");
    archived.options = { ...archived.options, archive: true, gray: true };
    expect(await runConversion(archived, {})).toMatchObject({ outputs: ["C:/out/a.zip"], count: 7 });
    expect(convertToImages.mock.calls[0][0]).toMatchObject({ archive: true, gray: true });
    archived.options = { ...archived.options, single: true };
    expect(await runConversion(archived, {})).toMatchObject({ count: 1 });
    expect(convertToImages.mock.calls[1][0]).toMatchObject({ archive: false });
  });

  it("shows the real size of extracted pictures", async () => {
    extractImages.mockResolvedValue({ outputs: ["C:/out/a-1-01.png"], count: 1, skipped: 0, bytes: 1234 });
    const outcome = await runConversion(pdfTo("extract-images"), {});
    expect(outcome).toMatchObject({ bytes: 1234, count: 1 });
  });

  it("names text pages that had no text layer", async () => {
    convertToText.mockResolvedValue({ output: "C:/out/a.txt", bytes: 3, textlessPages: [5] });
    const outcome = await runConversion(pdfTo("text"), {});
    expect(convertToText.mock.calls[0][0]).toMatchObject({ layout: true });
    expect(outcome.textless).toEqual({ pages: [5], key: "textlessFile" });
  });

  it("reads scanned pages with OCR only when a language is installed", async () => {
    convertToText.mockResolvedValue({ output: "C:/out/a.txt", bytes: 3, textlessPages: [], ocrPages: [1, 4] });
    const reading = pdfTo("text");
    reading.options = { ...reading.options, ocr: true, ocrLanguages: ["tur", "eng"] };
    expect(await runConversion(reading, {})).toMatchObject({ ocrPages: [1, 4] });
    expect(convertToText.mock.calls[0][0]).toMatchObject({ ocr: true, ocrLanguages: ["tur", "eng"] });
    reading.options = { ...reading.options, ocrLanguages: [] };
    await runConversion(reading, {});
    expect(convertToText.mock.calls[1][0]).toMatchObject({ ocr: false });
  });

  it("passes the Markdown picture choice and reports where the pictures went", async () => {
    convertToMarkdown.mockResolvedValue({ output: "C:/out/a.md", bytes: 3, textlessPages: [], ocrPages: [], pictureCount: 4, pictureFolder: "C:/out/a-images" });
    const markdown = pdfTo("markdown");
    markdown.options = { ...markdown.options, pictures: "files", ocr: false, ocrLanguages: [] };
    expect(await runConversion(markdown, {})).toMatchObject({ pictures: { count: 4, folder: "C:/out/a-images" } });
    expect(convertToMarkdown.mock.calls[0][0]).toMatchObject({ pictures: "files" });
    convertToMarkdown.mockResolvedValue({ output: "C:/out/a.md", bytes: 3, textlessPages: [], ocrPages: [], pictureCount: 0, pictureFolder: null });
    expect((await runConversion(markdown, {})).pictures).toBeUndefined();
  });
});
