import type { SourceCheck, SourceStatus } from "@/types";
import type { BibEntry } from "@/types/studio";
import { parseCslJson } from "./cslJson";
import { namesText } from "./sourceDraft";
import { claimKey, keyBase } from "./sourceKeys";

export const UPDATED_FIELDS = ["title", "journal", "booktitle", "volume", "number", "pages", "year", "publisher"];

export const STATUS_TONES: Record<SourceStatus, "danger" | "warning" | "fine" | "quiet"> = {
  retracted: "danger",
  withdrawn: "danger",
  expressionOfConcern: "warning",
  corrected: "warning",
  ok: "fine",
  notFound: "quiet",
  failed: "quiet",
};

const NOTICE_ORDER = ["retraction", "partial_retraction", "removal", "withdrawal", "expression_of_concern"];
const MARKUP = /<(\/?)([a-z][\w:.-]*)[^>]{0,200}>/gi;
const INLINE_TAGS = /^(?:i|b|em|strong|u|sub|sup|sc|span|a|font|scp|italic|bold|mml:.*|jats:(?:italic|bold|sub|sup|sc|underline|monospace))$/i;
const WORD_TAGS = /^(?:i|b|em|strong|u|sc|scp|italic|bold|jats:(?:italic|bold|sc|underline|monospace))$/i;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const TEXT_FIELDS = ["title", "container-title", "subtitle", "abstract"];

export type SourceChange = { field: string; before: string; after: string };

const DOI_SHAPE = /^10\.\d{4,9}\/\S{1,300}$/;
const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>]{1,300}/g;
const DOI_PREFIX = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i;
const TRAILING_PUNCTUATION = /[.,;:'"]+$/;

function unquoted(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function trimmedDoi(candidate: string): string {
  const count = (text: string, character: string) => text.split(character).length - 1;
  let text = candidate.replace(TRAILING_PUNCTUATION, "");
  while (text.endsWith(")") && count(text, ")") > count(text, "(")) text = text.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  while (text.endsWith("]") && count(text, "]") > count(text, "[")) text = text.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  return text;
}

function doiInText(text: string): string | null {
  for (const match of text.matchAll(DOI_IN_TEXT)) {
    const doi = trimmedDoi(match[0]);
    if (DOI_SHAPE.test(doi)) return doi;
  }
  return null;
}

export function normalizedDoi(value: string): string | null {
  const text = unquoted(value.trim());
  const doi = trimmedDoi(text.replace(DOI_PREFIX, "").trim());
  if (DOI_SHAPE.test(doi)) return doi;
  const link = /^https?:\/\/[^/]*(\/[^?#]*)/i.exec(text);
  return doiInText(link ? link[1] : text);
}

export function doiKey(value: string): string {
  return (normalizedDoi(value) ?? value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "")).toLowerCase();
}

export function doiLink(doi: string): string {
  return `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
}

function decodedEntities(text: string): string {
  return text.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function gapFor(close: string, tag: string, before: string, after: string): string {
  if (!INLINE_TAGS.test(tag)) return " ";
  if (!WORD_TAGS.test(tag)) return "";
  return close ? (/^\p{L}/u.test(after) ? " " : "") : /[\p{L}\p{N}]$/u.test(before) ? " " : "";
}

export function plainText(text: string): string {
  return decodedEntities(text.replace(MARKUP, (whole: string, close: string, tag: string, offset: number) => gapFor(close, tag, text.slice(0, offset), text.slice(offset + whole.length))))
    .replace(/\s+/g, " ")
    .trim();
}

function plain(value: unknown): unknown {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? plainText(first) : first;
}

export function entryOfCsl(csl: string, taken: Set<string>): BibEntry | null {
  let item: unknown;
  try {
    item = JSON.parse(csl);
  } catch {
    return null;
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const cleaned = Object.fromEntries(
    Object.entries(item as Record<string, unknown>)
      .filter(([name]) => name !== "id" && name !== "citation-key")
      .map(([name, value]) => [name, TEXT_FIELDS.includes(name) ? plain(value) : value]),
  );
  const entry = parseCslJson(JSON.stringify(cleaned)).entries[0];
  if (!entry) return null;
  return { ...entry, key: claimKey("", keyBase(entry.authors, entry.fields.year ?? "", entry.fields.title ?? ""), taken) };
}

export function checkedDois(entries: BibEntry[]): string[] {
  const seen = new Set<string>();
  const dois: string[] = [];
  for (const entry of entries) {
    const doi = entry.fields.doi?.trim();
    if (!doi || seen.has(doiKey(doi))) continue;
    seen.add(doiKey(doi));
    dois.push(doi);
  }
  return dois;
}

export function checksByDoi(sent: string[], items: SourceCheck[]): Record<string, SourceCheck> {
  return Object.fromEntries(sent.flatMap((doi, index) => (items[index] ? [[doiKey(doi), items[index]]] : [])));
}

function rank(type: string): number {
  const index = NOTICE_ORDER.indexOf(type);
  return index === -1 ? NOTICE_ORDER.length : index;
}

export function leadingNotice(check: SourceCheck): string | null {
  const ranked = [...check.notices].sort((a, b) => rank(a.type) - rank(b.type));
  return ranked.find((notice) => notice.doi)?.doi ?? null;
}

export function sourceChanges(current: BibEntry, fetched: BibEntry): SourceChange[] {
  const changes: SourceChange[] = [];
  for (const field of UPDATED_FIELDS) {
    const after = fetched.fields[field]?.trim() ?? "";
    const before = current.fields[field]?.trim() ?? "";
    if (after && after !== before) changes.push({ field, before, after });
  }
  const authorsBefore = namesText(current.authors);
  const authorsAfter = namesText(fetched.authors);
  if (fetched.authors.length > 0 && authorsAfter !== authorsBefore) changes.push({ field: "authors", before: authorsBefore.replace(/\n/g, "; "), after: authorsAfter.replace(/\n/g, "; ") });
  return changes;
}

export function applyChanges(current: BibEntry, fetched: BibEntry, changes: SourceChange[]): BibEntry {
  const fields = { ...current.fields };
  let authors = current.authors;
  for (const change of changes) {
    if (change.field === "authors") authors = fetched.authors;
    else fields[change.field] = change.after;
  }
  return { ...current, fields, authors };
}

export function filledDraftFields(fields: Record<string, string>, fetched: BibEntry): Record<string, string> {
  return { ...fields, ...Object.fromEntries(Object.entries(fetched.fields).filter(([, value]) => value.trim())) };
}
