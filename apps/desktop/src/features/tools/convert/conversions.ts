import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Globe,
  ImageDown,
  Images,
  Presentation,
  ScrollText,
  Shapes,
} from "lucide-react";
import { dirnameOf, joinPath, numberedPath, pathKey } from "@/shared/lib/paths";

export type FromPdfMode = "docx" | "xlsx" | "pptx" | "images" | "extract-images" | "text" | "markdown" | "html" | "epub";
export type ToPdfMode = "images-to-pdf" | "file-to-pdf" | "svg-to-pdf" | "url-to-pdf";
export type ConvertMode = FromPdfMode | ToPdfMode;

export type ConversionEntry = {
  mode: ConvertMode;
  icon: LucideIcon;
  extension: string;
  requires?: "libreoffice";
};

export const FROM_PDF: ConversionEntry[] = [
  { mode: "docx", icon: FileType2, extension: "docx" },
  { mode: "xlsx", icon: FileSpreadsheet, extension: "xlsx" },
  { mode: "pptx", icon: Presentation, extension: "pptx" },
  { mode: "images", icon: FileImage, extension: "png" },
  { mode: "extract-images", icon: ImageDown, extension: "png" },
  { mode: "text", icon: FileText, extension: "txt" },
  { mode: "markdown", icon: ScrollText, extension: "md" },
  { mode: "html", icon: FileCode2, extension: "html" },
  { mode: "epub", icon: BookOpen, extension: "epub" },
];

export const TO_PDF: ConversionEntry[] = [
  { mode: "images-to-pdf", icon: Images, extension: "pdf" },
  { mode: "file-to-pdf", icon: FileType2, extension: "pdf", requires: "libreoffice" },
  { mode: "svg-to-pdf", icon: Shapes, extension: "pdf" },
  { mode: "url-to-pdf", icon: Globe, extension: "pdf" },
];

export const ALL_MODES: ConvertMode[] = [...FROM_PDF, ...TO_PDF].map((entry) => entry.mode);

export function isConvertMode(value: string | null): value is ConvertMode {
  return value !== null && (ALL_MODES as string[]).includes(value);
}

export const OFFICE_LIKE_EXTENSIONS = ["doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp"];
export const TEXT_LIKE_EXTENSIONS = ["txt", "md", "markdown", "html", "htm"];
export const EBOOK_EXTENSIONS = ["epub", "xps", "oxps", "mobi", "fb2", "cbz", "svg"];
export const SVG_EXTENSIONS = ["svg"];
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "bmp", "gif", "tif", "tiff", "pnm", "pgm", "ppm", "jp2", "jxr", "heic", "heif", "hif"];

export function svgWritesOneFile(count: number, combine: boolean): boolean {
  return count <= 1 || combine;
}

function splitName(path: string): { stem: string; extension: string } {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot + 1) } : { stem: name, extension: "" };
}

export function batchOutputName(files: string[], file: string): string {
  const { stem, extension } = splitName(file);
  const key = stem.toLocaleLowerCase();
  const shared = files.filter((other) => splitName(other).stem.toLocaleLowerCase() === key).length > 1;
  return shared && extension ? `${stem}-${extension.toLowerCase()}.pdf` : `${stem}.pdf`;
}

export function batchOutputPaths(files: string[], outputDir?: string): string[] {
  const taken = new Set<string>();
  return files.map((file) => {
    const wanted = joinPath(outputDir || dirnameOf(file), batchOutputName(files, file));
    let candidate = wanted;
    for (let index = 2; taken.has(pathKey(candidate)); index += 1) candidate = numberedPath(wanted, index);
    taken.add(pathKey(candidate));
    return candidate;
  });
}

export function moveItem<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

export function pageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = 0;
  for (let index = 1; index <= sorted.length; index += 1) {
    if (index < sorted.length && sorted[index] === sorted[index - 1] + 1) continue;
    const first = sorted[start];
    const last = sorted[index - 1];
    if (first !== undefined && last !== undefined) runs.push(first === last ? `${first}` : `${first}-${last}`);
    start = index;
  }
  return runs.join(", ");
}
