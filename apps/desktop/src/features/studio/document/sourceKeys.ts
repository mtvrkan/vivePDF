import type { BibEntry, BibName } from "@/types/studio";
import { isValidKey, MAX_FIELD_CHARS } from "./bibtex";

const MONTH_PREFIXES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function ascii(text: string): string {
  return text
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function keyBase(authors: BibName[], year: string, title: string): string {
  const family = authors.find((name) => !name.others)?.family ?? "";
  const word = title.split(/\s+/).find((part) => ascii(part).length > 3) ?? "";
  return `${ascii(family).slice(0, 20)}${year.slice(0, 4)}${ascii(word).slice(0, 12)}` || "source";
}

export function claimKey(wanted: string, fallback: string, taken: Set<string>): string {
  const base = isValidKey(wanted) ? wanted : fallback;
  let key = base;
  for (let attempt = 0; taken.has(key.toLowerCase()); attempt += 1) {
    key = attempt < 26 ? `${base}${String.fromCharCode(97 + attempt)}` : `${base}-${attempt - 24}`;
  }
  taken.add(key.toLowerCase());
  return key;
}

export function clip(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_CHARS) : "";
}

export function setField(entry: BibEntry, name: string, value: unknown) {
  const text = clip(value);
  if (text && !entry.fields[name]) entry.fields[name] = text;
}

export function monthNumber(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (/^\d{1,2}$/.test(text)) {
    const month = Number(text);
    return month >= 1 && month <= 12 ? month : null;
  }
  const index = MONTH_PREFIXES.indexOf(text.slice(0, 3));
  return index >= 0 ? index + 1 : null;
}

export function bareDoi(value: string): string {
  return value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
}

export function joinPages(first: string, last: string): string {
  return first && last && last !== first ? `${first}–${last}` : first || last;
}

export function splitPages(pages: string): [string, string] {
  const [first = "", last = ""] = pages.split(/\s*(?:-{1,3}|–|—)\s*/);
  return [first.trim(), last.trim()];
}
