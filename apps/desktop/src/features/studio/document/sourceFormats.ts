import { SOURCE_LIBRARY_EXTENSIONS, type BibEntry, type BibName } from "@/types/studio";
import { parseBibtex, type BibParseResult } from "./bibtex";
import { parseCslJson, writeCslJson } from "./cslJson";
import { parseRis, writeRis } from "./ris";

export type SourceFormat = "bibtex" | "ris" | "csl";

export const SOURCE_FORMATS: SourceFormat[] = ["bibtex", "ris", "csl"];
export const SOURCE_FILE_EXTENSIONS = [...SOURCE_LIBRARY_EXTENSIONS, "json"];
export const FORMAT_EXTENSIONS: Record<SourceFormat, string> = { bibtex: "bib", ris: "ris", csl: "json" };

const VERBATIM_FIELDS = new Set(["url", "doi", "eprint", "isbn", "issn"]);
const RIS_START = /^\s*TY {2}-/m;

export function formatOfPath(path: string): SourceFormat {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  if (extension === "ris") return "ris";
  if (extension === "json") return "csl";
  return "bibtex";
}

export function detectFormat(text: string): SourceFormat {
  const start = text.replace(/^\uFEFF/, "").trimStart();
  if (start.startsWith("[") || start.startsWith("{")) return "csl";
  if (RIS_START.test(text) && !/@\w+\s*[{(]/.test(text)) return "ris";
  return "bibtex";
}

export function parseSources(text: string, format: SourceFormat = detectFormat(text)): BibParseResult {
  if (format === "csl") return parseCslJson(text);
  if (format === "ris") return parseRis(text);
  return parseBibtex(text);
}

function escapeLatex(text: string): string {
  return text
    .replace(/[\\{}&%$#_~]/g, (char) => (char === "\\" ? "\\textbackslash{}" : char === "~" ? "\\textasciitilde{}" : `\\${char}`))
    .replace(/\u00a0/g, "~")
    .replace(/-(?=-)/g, "-{}")
    .replace(/`(?=`)/g, "`{}")
    .replace(/'(?=')/g, "'{}");
}

function verbatim(text: string): string {
  return text.replace(/[{}\s]/g, "").replace(/[%#&_$~]/g, (char) => `\\${char}`);
}

function protect(text: string): string {
  const escaped = escapeLatex(text);
  return /,|\s(?:and)\s/i.test(text) || /^and$/i.test(text) ? `{${escaped}}` : escaped;
}

function nameText(name: BibName): string {
  if (name.others) return "others";
  if (name.literal) return `{${escapeLatex(name.family)}}`;
  if (!name.given) return /\s/.test(name.family) ? `${protect(name.family)},` : protect(name.family);
  return `${protect(name.family)}, ${protect(name.given)}`;
}

export function writeBibtex(entries: BibEntry[]): string {
  return entries
    .map((entry) => {
      const lines: string[] = [];
      if (entry.authors.length > 0) lines.push(`  author = {${entry.authors.map(nameText).join(" and ")}}`);
      if (entry.editors.length > 0) lines.push(`  editor = {${entry.editors.map(nameText).join(" and ")}}`);
      for (const [name, value] of Object.entries(entry.fields)) {
        if (!value || !/^[a-z][a-z0-9_\-:.+/]*$/.test(name)) continue;
        lines.push(`  ${name} = {${VERBATIM_FIELDS.has(name) ? verbatim(value) : escapeLatex(value)}}`);
      }
      return `@${entry.type}{${[entry.key, ...lines].join(",\n")}\n}`;
    })
    .join("\n\n")
    .concat(entries.length > 0 ? "\n" : "");
}

export function writeSources(entries: BibEntry[], format: SourceFormat): string {
  if (format === "csl") return writeCslJson(entries);
  if (format === "ris") return writeRis(entries);
  return writeBibtex(entries);
}
