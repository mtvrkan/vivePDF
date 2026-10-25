import type { BibEntry, BibName } from "@/types/studio";
import { decodeLatex, groupEnd } from "./bibtexLatex";

export { decodeLatex } from "./bibtexLatex";

export const MAX_SOURCES = 10000;
export const MAX_FIELD_CHARS = 20000;
const MAX_FIELDS = 200;
const KEY = /^[^\s,{}()"#%=\\]{1,200}$/;
const IDENTIFIER = /[A-Za-z0-9_\-:.+/']/;
const VERBATIM_FIELDS = new Set(["url", "doi", "eprint", "isbn", "issn"]);
const MONTHS: Record<string, string> = { jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6", jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12" };
const THESIS_KINDS: Record<string, string> = { phdthesis: "phdthesis", phd: "phdthesis", mathesis: "mastersthesis", mastersthesis: "mastersthesis", masters: "mastersthesis", ma: "mastersthesis" };
const INHERITED_AS: Record<string, string> = { title: "booktitle", subtitle: "booksubtitle", titleaddon: "booktitleaddon", shorttitle: "" };
const NEXT_ENTRY = /^[ \t\r]*@[A-Za-z]+[ \t]*[{(]/;
const ENTRY_INSIDE = /\n[ \t\r]*@[A-Za-z]+[ \t]*[{(]/;
const HIDDEN_TYPES = new Set(["xdata", "set"]);

export function isValidKey(key: string): boolean {
  return KEY.test(key);
}

export type BibField = { name: string; start: number; end: number };

export type BibBlock = { key: string; start: number; end: number; header: number; type: string; fields: BibField[]; entry: number };

export type BibLibrary = { text: string; blocks: BibBlock[]; snapshot: BibEntry[]; inherited: Record<string, string[]> };

export type BibParseResult = { entries: BibEntry[]; skipped: number; duplicates: number; truncated?: number; clipped?: number; library?: BibLibrary };

type Cursor = { text: string; at: number };

class BibSyntaxError extends Error {}

function skipSpace(cursor: Cursor) {
  while (cursor.at < cursor.text.length && /\s/.test(cursor.text[cursor.at])) cursor.at += 1;
}

function skipSpaceAndComments(cursor: Cursor) {
  for (;;) {
    skipSpace(cursor);
    if (cursor.text[cursor.at] !== "%") return;
    const lineEnd = cursor.text.indexOf("\n", cursor.at);
    cursor.at = lineEnd < 0 ? cursor.text.length : lineEnd + 1;
  }
}

function identifier(cursor: Cursor): string {
  const start = cursor.at;
  while (cursor.at < cursor.text.length && IDENTIFIER.test(cursor.text[cursor.at])) cursor.at += 1;
  return cursor.text.slice(start, cursor.at);
}

function entryStartsAt(text: string, index: number): boolean {
  return NEXT_ENTRY.test(text.slice(index + 1, index + 80));
}

function braced(cursor: Cursor): string {
  const close = groupEnd(cursor.text, cursor.at);
  if (close < 0) throw new BibSyntaxError("unclosed brace");
  const body = cursor.text.slice(cursor.at + 1, close);
  if (ENTRY_INSIDE.test(body)) throw new BibSyntaxError("value runs into the next entry");
  cursor.at = close + 1;
  return body;
}

function quoted(cursor: Cursor): string {
  const start = cursor.at + 1;
  let depth = 0;
  for (let index = start; index < cursor.text.length; index += 1) {
    const char = cursor.text[index];
    if (char === "\\") index += 1;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === "\n" && entryStartsAt(cursor.text, index)) throw new BibSyntaxError("value runs into the next entry");
    else if (char === '"' && depth <= 0) {
      cursor.at = index + 1;
      return cursor.text.slice(start, index);
    }
  }
  throw new BibSyntaxError("unclosed quote");
}

function piece(cursor: Cursor, macros: Map<string, string>): string {
  skipSpace(cursor);
  const char = cursor.text[cursor.at];
  if (char === "{") return braced(cursor);
  if (char === '"') return quoted(cursor);
  const word = identifier(cursor);
  if (!word) throw new BibSyntaxError("missing value");
  return /^\d+$/.test(word) ? word : (macros.get(word.toLowerCase()) ?? word);
}

function value(cursor: Cursor, macros: Map<string, string>): { raw: string; end: number } {
  let raw = piece(cursor, macros);
  let end = cursor.at;
  skipSpace(cursor);
  while (cursor.text[cursor.at] === "#") {
    cursor.at += 1;
    raw += piece(cursor, macros);
    end = cursor.at;
    skipSpace(cursor);
  }
  return { raw, end };
}

type Assignment = { name: string; raw: string; field: BibField };

function assignments(cursor: Cursor, close: string, macros: Map<string, string>): Assignment[] {
  const found: Assignment[] = [];
  for (;;) {
    skipSpaceAndComments(cursor);
    const char = cursor.text[cursor.at];
    if (char === undefined) throw new BibSyntaxError("unclosed entry");
    if (char === close) {
      cursor.at += 1;
      return found;
    }
    if (char === ",") {
      cursor.at += 1;
      continue;
    }
    const start = cursor.at;
    const name = identifier(cursor);
    skipSpace(cursor);
    if (!name || cursor.text[cursor.at] !== "=") throw new BibSyntaxError("expected a field");
    cursor.at += 1;
    const { raw, end } = value(cursor, macros);
    found.push({ name: name.toLowerCase(), raw, field: { name: name.toLowerCase(), start, end } });
    skipSpace(cursor);
    const next = cursor.text[cursor.at];
    if (next !== "," && next !== close && next !== "%") throw new BibSyntaxError("expected a comma");
  }
}

function skipGroup(cursor: Cursor, close: string) {
  const open = close === "}" ? "{" : "(";
  let depth = 1;
  while (cursor.at < cursor.text.length && depth > 0) {
    const char = cursor.text[cursor.at];
    if (char === "\\") cursor.at += 1;
    else if (char === open) depth += 1;
    else if (char === close) depth -= 1;
    cursor.at += 1;
  }
}

function citeKey(cursor: Cursor, close: string): string {
  const start = cursor.at;
  while (cursor.at < cursor.text.length && cursor.text[cursor.at] !== "," && cursor.text[cursor.at] !== close && cursor.text[cursor.at] !== "\n") cursor.at += 1;
  const key = cursor.text.slice(start, cursor.at).trim();
  if (!KEY.test(key)) throw new BibSyntaxError("bad key");
  return key;
}

function topLevel(raw: string, separator: (char: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      current += char + (raw[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (depth === 0 && separator(char)) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

function wholeGroup(raw: string): boolean {
  return raw.startsWith("{") && groupEnd(raw, 0) === raw.length - 1;
}

function startsLower(word: string): boolean {
  if (word.startsWith("{")) return false;
  const first = decodeLatex(word)[0];
  return first !== undefined && first !== first.toUpperCase() && first === first.toLowerCase();
}

function nameOf(raw: string): BibName | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.toLowerCase() === "others") return { family: "", given: "", others: true };
  if (wholeGroup(text)) return { family: decodeLatex(text), given: "", literal: true };
  const parts = topLevel(text, (char) => char === ",");
  if (parts.length >= 3) return { family: decodeLatex(parts[0]), given: decodeLatex(parts[parts.length - 1]), suffix: decodeLatex(parts[1]) };
  if (parts.length === 2) return { family: decodeLatex(parts[0]), given: decodeLatex(parts[1]) };
  const words = topLevel(text, (char) => /\s/.test(char)).filter(Boolean);
  if (words.length === 1) return { family: decodeLatex(words[0]), given: "" };
  const particle = words.findIndex((word, position) => position > 0 && position < words.length - 1 && startsLower(word));
  const split = particle > 0 ? particle : words.length - 1;
  return { family: decodeLatex(words.slice(split).join(" ")), given: decodeLatex(words.slice(0, split).join(" ")) };
}

export function parseNames(raw: string): BibName[] {
  const words = topLevel(raw, (char) => /\s/.test(char)).filter(Boolean);
  const names: string[][] = [[]];
  for (const word of words) {
    if (word.toLowerCase() === "and") names.push([]);
    else names[names.length - 1].push(word);
  }
  return names.map((name) => nameOf(name.join(" "))).filter((name): name is BibName => name !== null);
}

function verbatim(name: string, raw: string): string {
  const text = raw.replace(/\\([_%&#~$])/g, "$1").replace(/[{}]/g, "");
  if (name === "url") return text.trim().split(/\s+/)[0] ?? "";
  return text.replace(/\s+/g, "");
}

type Built = { entry: BibEntry; clipped: number };

function entryOf(type: string, key: string, pairs: Assignment[]): Built {
  const entry: BibEntry = { key, type, fields: {}, authors: [], editors: [] };
  let clipped = 0;
  const seen = new Set<string>();
  for (const { name, raw } of pairs.slice(0, MAX_FIELDS)) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (raw.length > MAX_FIELD_CHARS) clipped += 1;
    const text = raw.slice(0, MAX_FIELD_CHARS);
    if (name === "author") entry.authors = parseNames(text);
    else if (name === "editor") entry.editors = parseNames(text);
    else {
      const decoded = VERBATIM_FIELDS.has(name) ? verbatim(name, text) : decodeLatex(text);
      if (decoded) entry.fields[name] = decoded;
    }
  }
  const thesis = THESIS_KINDS[(entry.fields.type ?? "").toLowerCase().replace(/[^a-z]/g, "")];
  if (type === "thesis" && thesis) {
    entry.type = thesis;
    delete entry.fields.type;
  }
  return { entry, clipped: clipped + Math.max(0, pairs.length - MAX_FIELDS) };
}

function inheritFrom(child: BibEntry, parent: BibEntry, viaCrossref: boolean): string[] {
  const taken: string[] = [];
  for (const [name, value] of Object.entries(parent.fields)) {
    if (name === "crossref" || name === "xdata" || name === "ids" || name === "entryset") continue;
    const target = viaCrossref && name in INHERITED_AS ? INHERITED_AS[name] : name;
    if (!target || child.fields[target]) continue;
    child.fields[target] = value;
    taken.push(target);
  }
  if (child.editors.length === 0 && parent.editors.length > 0) {
    child.editors = parent.editors;
    taken.push("editor");
  }
  if (!viaCrossref && child.authors.length === 0 && parent.authors.length > 0) {
    child.authors = parent.authors;
    taken.push("author");
  }
  return taken;
}

function resolveInheritance(entries: BibEntry[]): Record<string, string[]> {
  const byKey = new Map(entries.map((entry) => [entry.key.toLowerCase(), entry]));
  const inherited: Record<string, string[]> = {};
  for (const entry of entries) {
    const parents: [string, boolean][] = [
      ...(entry.fields.xdata ?? "")
        .split(",")
        .map((key): [string, boolean] => [key.trim(), false])
        .filter(([key]) => key),
      ...(entry.fields.crossref ? [[entry.fields.crossref.trim(), true] as [string, boolean]] : []),
    ];
    for (const [key, viaCrossref] of parents) {
      const parent = byKey.get(key.toLowerCase());
      if (!parent || parent === entry) continue;
      const taken = inheritFrom(entry, parent, viaCrossref);
      if (taken.length > 0) inherited[entry.key.toLowerCase()] = [...(inherited[entry.key.toLowerCase()] ?? []), ...taken];
    }
  }
  return inherited;
}

function commentedOut(text: string, at: number): boolean {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  return text.slice(lineStart, at).includes("%");
}

export function parseBibtex(text: string): BibParseResult {
  const macros = new Map(Object.entries(MONTHS));
  const parsed: { entry: BibEntry; block: BibBlock }[] = [];
  const keys = new Set<string>();
  const cursor: Cursor = { text, at: 0 };
  let skipped = 0;
  let duplicates = 0;
  let truncated = 0;
  let clipped = 0;
  for (;;) {
    const start = text.indexOf("@", cursor.at);
    if (start < 0) break;
    cursor.at = start + 1;
    if (commentedOut(text, start)) continue;
    const type = identifier(cursor).toLowerCase();
    skipSpace(cursor);
    const open = text[cursor.at];
    if (!type || (open !== "{" && open !== "(")) continue;
    const close = open === "{" ? "}" : ")";
    cursor.at += 1;
    if (type === "comment" || type === "preamble") {
      skipGroup(cursor, close);
      continue;
    }
    try {
      if (type === "string") {
        for (const { name, raw } of assignments(cursor, close, macros)) macros.set(name, raw);
        continue;
      }
      const key = citeKey(cursor, close);
      const header = cursor.at;
      const pairs = assignments(cursor, close, macros);
      if (keys.has(key.toLowerCase())) {
        duplicates += 1;
        continue;
      }
      keys.add(key.toLowerCase());
      if (parsed.length >= MAX_SOURCES) {
        truncated += 1;
        continue;
      }
      const built = entryOf(type, key, pairs);
      clipped += built.clipped;
      parsed.push({ entry: built.entry, block: { key, start, end: cursor.at, header, type: text.slice(start + 1, start + 1 + type.length), fields: pairs.map((pair) => pair.field), entry: parsed.length } });
    } catch (error) {
      if (!(error instanceof BibSyntaxError)) throw error;
      skipped += 1;
      cursor.at = start + 1;
    }
  }
  const all = parsed.map((item) => item.entry);
  const inherited = resolveInheritance(all);
  const visible = parsed.filter((item) => !HIDDEN_TYPES.has(item.entry.type));
  const entries = visible.map((item) => item.entry);
  const blocks = visible.map((item, position) => ({ ...item.block, entry: position }));
  const snapshot = entries.map((entry) => structuredClone(entry));
  return { entries, skipped, duplicates, truncated, clipped, library: { text, blocks, snapshot, inherited } };
}

function cleanName(value: unknown): BibName | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const family = typeof source.family === "string" ? source.family.slice(0, 300) : "";
  const given = typeof source.given === "string" ? source.given.slice(0, 300) : "";
  const suffix = typeof source.suffix === "string" ? source.suffix.slice(0, 40) : "";
  if (source.others === true) return { family: "", given: "", others: true };
  if (!family && !given) return null;
  if (source.literal === true) return { family, given, literal: true };
  return suffix ? { family, given, suffix } : { family, given };
}

function cleanNames(value: unknown): BibName[] {
  return Array.isArray(value) ? value.slice(0, 200).map(cleanName).filter((name): name is BibName => name !== null) : [];
}

export function normalizeSources(value: unknown): BibEntry[] {
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  const sources: BibEntry[] = [];
  for (const item of value.slice(0, MAX_SOURCES)) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const key = typeof source.key === "string" ? source.key : "";
    if (!KEY.test(key) || keys.has(key.toLowerCase())) continue;
    keys.add(key.toLowerCase());
    const fields: Record<string, string> = {};
    if (source.fields && typeof source.fields === "object") {
      for (const [name, text] of Object.entries(source.fields as Record<string, unknown>).slice(0, MAX_FIELDS)) {
        if (typeof text === "string" && text) fields[name.toLowerCase()] = text.slice(0, MAX_FIELD_CHARS);
      }
    }
    sources.push({ key, type: typeof source.type === "string" ? source.type.toLowerCase().slice(0, 40) : "misc", fields, authors: cleanNames(source.authors), editors: cleanNames(source.editors) });
  }
  return sources;
}

export function mergeSources(current: BibEntry[], added: BibEntry[]): { sources: BibEntry[]; added: number; replaced: number } {
  const index = new Map(current.map((entry, position) => [entry.key.toLowerCase(), position]));
  const sources = [...current];
  let fresh = 0;
  let replaced = 0;
  for (const entry of added) {
    const position = index.get(entry.key.toLowerCase());
    if (position !== undefined) {
      sources[position] = entry;
      replaced += 1;
    } else if (sources.length < MAX_SOURCES) {
      index.set(entry.key.toLowerCase(), sources.length);
      sources.push(entry);
      fresh += 1;
    }
  }
  return { sources, added: fresh, replaced };
}
