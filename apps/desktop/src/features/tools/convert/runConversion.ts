import { invoke } from "@tauri-apps/api/core";
import type { SheetLabels } from "@/shared/lib/sheetLabels";
import { toRpcError, type RpcCallOptions } from "@/shared/rpc/client";
import {
  convertToDocx,
  convertToEpub,
  convertToHtml,
  convertToImages,
  convertToMarkdown,
  convertToPptx,
  convertToText,
  convertToXlsx,
  extractImages,
  fileToPdf,
  imagesToPdf,
  svgToPdf,
  urlToPdf,
} from "@/shared/rpc/operations";
import type { ImageFit, ImageFormat, MarkdownPictures, PptxMode, RpcError, XlsxFormat, XlsxSheets } from "@/types";
import { batchOutputPaths, svgWritesOneFile, type ConvertMode } from "./conversions";

export type ConvertRun = {
  mode: ConvertMode;
  source?: { path: string; password?: string };
  output: string;
  outputDir?: string;
  pages?: string;
  sheetLabels?: SheetLabels;
  options: {
    format: ImageFormat;
    dpi: number;
    quality: number;
    layout: boolean;
    paper: "a4" | "letter";
    images: string[];
    folders: string[];
    recursive: boolean;
    sort: "name" | "date";
    pageSize: "image" | "a4" | "letter";
    orientation: "auto" | "portrait" | "landscape";
    margin: number;
    files: string[];
    svgFiles: string[];
    combineSvg: boolean;
    url: string;
    readerMode: boolean;
    includeImages: boolean;
    split: "auto" | "chapter" | "page";
    language: string;
    title: string;
    author: string;
    sheets: XlsxSheets;
    xlsxFormat: XlsxFormat;
    borderless: boolean;
    single: boolean;
    transparent: boolean;
    gray: boolean;
    archive: boolean;
    ocr: boolean;
    ocrLanguages: string[];
    pictures: MarkdownPictures;
    headerFooter: boolean;
    fit: ImageFit;
    cover: boolean;
    pptxMode: PptxMode;
  };
  overwrite?: boolean;
};

export type FailedFile = { path: string; error: RpcError };

type ConvertOutcome = {
  outputs: string[];
  bytes: number;
  count: number;
  label: string;
  skipped?: number;
  textless?: { pages: number[]; key: TextlessKey };
  ocrPages?: number[];
  pictures?: { count: number; folder: string | null };
  headerFooterMoved?: boolean;
  skippedPages?: number[];
  reducedPages?: number[];
  textPages?: number[];
  noTables?: boolean;
  failed?: FailedFile[];
};

type TextlessKey = "textlessPages" | "textlessOffice" | "textlessFile";

function textless(pages: number[], key: TextlessKey) {
  return pages.length ? { pages, key } : undefined;
}

async function firstExisting(paths: string[]): Promise<string | null> {
  try {
    const exists = await invoke<boolean[]>("path_exists", { paths });
    return paths.find((_, index) => exists[index] === true) ?? null;
  } catch {
    return null;
  }
}

function stopsTheBatch(error: RpcError, signal?: AbortSignal): boolean {
  return error.code === "CANCELLED" || signal?.aborted === true || (error.code === "INVALID_PARAMS" && error.data?.exists === true);
}

async function filesToPdf(run: ConvertRun, callOptions: RpcCallOptions, files = run.options.files): Promise<ConvertOutcome> {
  if (files.length === 1) {
    const result = await fileToPdf({ path: files[0], output: run.output, overwrite: run.overwrite, paper: run.options.paper }, callOptions);
    return { outputs: [result.output], bytes: result.bytes, count: result.pageCount, label: "pages" };
  }
  const targets = batchOutputPaths(files, run.outputDir);
  if (!run.overwrite) {
    const taken = await firstExisting(targets);
    if (taken) throw { code: "INVALID_PARAMS", message: "the output file already exists", data: { exists: true, path: taken } } satisfies RpcError;
  }
  const outputs: string[] = [];
  const failed: FailedFile[] = [];
  let bytes = 0;
  let pages = 0;
  for (const [index, file] of files.entries()) {
    const detail = { current: index + 1, total: files.length };
    const report = (fraction: number) =>
      callOptions.onProgress?.({ id: "", progress: (index + Math.min(Math.max(fraction, 0), 1)) / files.length, message: "progress.converting", detail });
    report(0);
    try {
      const result = await fileToPdf(
        { path: file, output: targets[index], overwrite: run.overwrite, paper: run.options.paper },
        { ...callOptions, onProgress: (update) => report(update.progress) },
      );
      outputs.push(result.output);
      bytes += result.bytes;
      pages += result.pageCount;
    } catch (caught) {
      const error = toRpcError(caught);
      if (stopsTheBatch(error, callOptions.signal)) throw error;
      failed.push({ path: file, error });
    }
  }
  if (outputs.length === 0 && failed[0]) throw failed[0].error;
  return { outputs, bytes, count: pages, label: "pages", failed };
}

export async function runConversion(run: ConvertRun, callOptions: RpcCallOptions): Promise<ConvertOutcome> {
  const base = { path: run.source?.path ?? "", password: run.source?.password, output: run.output, overwrite: run.overwrite, pages: run.pages };
  const opts = run.options;
  const reading = { ocr: opts.ocr && opts.ocrLanguages.length > 0, ocrLanguages: opts.ocrLanguages };
  switch (run.mode) {
    case "docx": {
      const result = await convertToDocx({ ...base, headerFooter: opts.headerFooter }, callOptions);
      return {
        outputs: [result.output],
        bytes: result.bytes,
        count: 1,
        label: "files",
        skippedPages: result.skippedPages,
        textless: textless(result.textlessPages, "textlessOffice"),
        headerFooterMoved: result.headerLines + result.footerLines > 0,
      };
    }
    case "xlsx": {
      const result = await convertToXlsx({ ...base, sheets: opts.sheets, format: opts.xlsxFormat, borderless: opts.borderless, ...run.sheetLabels }, callOptions);
      return {
        outputs: [result.output],
        bytes: result.bytes,
        count: result.tableCount,
        label: "tables",
        noTables: result.tableCount === 0 && result.textPages.length > 0,
        textPages: result.tableCount > 0 ? result.textPages : [],
        textless: textless(result.textlessPages, "textlessOffice"),
      };
    }
    case "pptx": {
      const result = await convertToPptx({ ...base, dpi: opts.dpi, mode: opts.pptxMode }, callOptions);
      return { outputs: [result.output], bytes: result.bytes, count: result.pageCount, label: "slides" };
    }
    case "images": {
      const result = await convertToImages(
        {
          path: base.path,
          password: base.password,
          outputDir: run.outputDir ?? "",
          format: opts.format,
          dpi: opts.dpi,
          quality: opts.quality,
          pages: run.pages,
          overwrite: run.overwrite,
          single: opts.single,
          transparent: opts.transparent && opts.format !== "jpg",
          gray: opts.gray,
          archive: opts.archive && !opts.single,
        },
        callOptions,
      );
      const count = opts.archive && !opts.single ? result.pageCount : result.outputs.length;
      return { outputs: result.outputs, bytes: result.bytes, count, label: "images", reducedPages: result.reducedPages };
    }
    case "extract-images": {
      const result = await extractImages({ path: base.path, password: base.password, outputDir: run.outputDir ?? "", pages: run.pages }, callOptions);
      return { outputs: result.outputs, bytes: result.bytes, count: result.count, label: "images" };
    }
    case "text": {
      const result = await convertToText({ ...base, ...reading, layout: opts.layout }, callOptions);
      return { outputs: [result.output], bytes: result.bytes, count: 1, label: "files", textless: textless(result.textlessPages, "textlessFile"), ocrPages: result.ocrPages };
    }
    case "markdown": {
      const result = await convertToMarkdown({ ...base, ...reading, pictures: opts.pictures }, callOptions);
      return {
        outputs: [result.output],
        bytes: result.bytes,
        count: 1,
        label: "files",
        textless: textless(result.textlessPages, "textlessPages"),
        ocrPages: result.ocrPages,
        pictures: result.pictureCount > 0 ? { count: result.pictureCount, folder: result.pictureFolder } : undefined,
      };
    }
    case "html": {
      const result = await convertToHtml({ ...base, ...reading }, callOptions);
      return { outputs: [result.output], bytes: result.bytes, count: 1, label: "files", textless: textless(result.textlessPages, "textlessFile"), ocrPages: result.ocrPages };
    }
    case "epub": {
      const result = await convertToEpub(
        { ...base, ...reading, split: opts.split, includeImages: opts.includeImages, language: opts.language, title: opts.title.trim() || undefined, author: opts.author.trim() || undefined, cover: opts.cover },
        callOptions,
      );
      return { outputs: [result.output], bytes: result.bytes, count: result.chapters, label: "chapters", textless: textless(result.textlessPages, "textlessFile"), ocrPages: result.ocrPages };
    }
    case "images-to-pdf": {
      const result = await imagesToPdf(
        {
          images: opts.images,
          folders: opts.folders,
          recursive: opts.recursive,
          sort: opts.sort,
          pageSize: opts.pageSize,
          orientation: opts.orientation,
          margin: opts.margin,
          fit: opts.fit,
          output: run.output,
          overwrite: run.overwrite,
        },
        callOptions,
      );
      return { outputs: [result.output], bytes: result.bytes, count: result.pageCount, label: "pages", skipped: result.skipped.length };
    }
    case "file-to-pdf":
      return filesToPdf(run, callOptions);
    case "svg-to-pdf": {
      if (!svgWritesOneFile(opts.svgFiles.length, opts.combineSvg)) return filesToPdf(run, callOptions, opts.svgFiles);
      const result = await svgToPdf({ paths: opts.svgFiles, output: run.output, overwrite: run.overwrite }, callOptions);
      return { outputs: [result.output], bytes: result.bytes, count: result.pageCount, label: "pages" };
    }
    case "url-to-pdf": {
      const result = await urlToPdf(
        {
          url: opts.url,
          output: run.output,
          overwrite: run.overwrite,
          paper: opts.paper,
          readerMode: opts.readerMode,
          includeImages: opts.includeImages,
        },
        callOptions,
      );
      return { outputs: [result.output], bytes: result.bytes, count: result.pageCount, label: "pages" };
    }
  }
}
