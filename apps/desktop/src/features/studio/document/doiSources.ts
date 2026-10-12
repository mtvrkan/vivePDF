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
const MARKUP = /<[^>]{1,200}>/g;
const TEXT_FIELDS = ["title", "container-title", "subtitle", "abstract"];

export type SourceChange = { field: string; before: string; after: string };

export function doiKey(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

export function doiLink(doi: string): string {
  return `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
}

function plain(value: unknown): unknown {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.replace(MARKUP, " ").replace(/\s+/g, " ").trim() : first;
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
