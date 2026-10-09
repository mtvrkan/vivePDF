import type { BibEntry, BibName } from "@/types/studio";

export const MAX_SOURCES = 2000;
export const MAX_FIELD_CHARS = 4000;
const MAX_FIELDS = 60;
const KEY = /^[^\s,{}()"#%'=\\]{1,200}$/;
const IDENTIFIER = /[A-Za-z0-9_\-:.+/]/;
const VERBATIM_FIELDS = new Set(["url", "doi", "eprint", "isbn", "issn"]);
const MONTHS: Record<string, string> = { jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6", jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12" };
const ACCENTS: Record<string, string> = {
  '"': "\u0308",
  "'": "\u0301",
  "`": "\u0300",
  "^": "\u0302",
  "~": "\u0303",
  "=": "\u0304",
  ".": "\u0307",
  u: "\u0306",
  v: "\u030c",
  c: "\u0327",
  H: "\u030b",
  k: "\u0328",
  r: "\u030a",
  d: "\u0323",
  b: "\u0331",
};
const SYMBOLS: Record<string, string> = {
  i: "ı",
  j: "ȷ",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  ss: "ß",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  textendash: "–",
  textemdash: "—",
  textquoteleft: "‘",
  textquoteright: "’",
  textquotedblleft: "“",
  textquotedblright: "”",
  textsection: "§",
  S: "§",
  P: "¶",
  dag: "†",
  copyright: "©",
  textregistered: "®",
  texttrademark: "™",
  ldots: "…",
  dots: "…",
  textellipsis: "…",
  euro: "€",
  pounds: "£",
  LaTeX: "LaTeX",
  TeX: "TeX",
};
const ESCAPED = new Set(["&", "%", "$", "#", "_", "{", "}"]);
const SPACING = new Set([" ", ",", ";", ":"]);
const DOTLESS: Record<string, string> = { ı: "i", ȷ: "j" };

export type BibParseResult = { entries: BibEntry[]; skipped: number; duplicates: number };

type Cursor = { text: string; at: number };

class BibSyntaxError extends Error {}

function skipSpace(cursor: Cursor) {
  while (cursor.at < cursor.text.length && /\s/.test(cursor.text[cursor.at])) cursor.at += 1;
}

function identifier(cursor: Cursor): string {
  const start = cursor.at;
  while (cursor.at < cursor.text.length && IDENTIFIER.test(cursor.text[cursor.at])) cursor.at += 1;
  return cursor.text.slice(start, cursor.at);
}

function braced(cursor: Cursor): string {
  const start = cursor.at + 1;
  let depth = 0;
  for (let index = cursor.at; index < cursor.text.length; index += 1) {
    const char = cursor.text[index];
    if (char === "\\") index += 1;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) {
      cursor.at = index + 1;
      return cursor.text.slice(start, index);
    }
  }
  throw new BibSyntaxError("unclosed brace");
}

function quoted(cursor: Cursor): string {
  const start = cursor.at + 1;
  let depth = 0;
  for (let index = start; index < cursor.text.length; index += 1) {
    const char = cursor.text[index];
    if (char === "\\") index += 1;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === '"' && depth === 0) {
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
  return /^\d+$/.test(word) ? word : (macros.get(word.toLowerCase()) ?? "");
}

function value(cursor: Cursor, macros: Map<string, string>): string {
  let result = piece(cursor, macros);
  skipSpace(cursor);
  while (cursor.text[cursor.at] === "#") {
    cursor.at += 1;
    result += piece(cursor, macros);
    skipSpace(cursor);
  }
  return result;
}

function assignments(cursor: Cursor, close: string, macros: Map<string, string>): [string, string][] {
  const found: [string, string][] = [];
  for (;;) {
    skipSpace(cursor);
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
    const name = identifier(cursor);
    skipSpace(cursor);
    if (!name || cursor.text[cursor.at] !== "=") throw new BibSyntaxError("expected a field");
    cursor.at += 1;
    found.push([name.toLowerCase(), value(cursor, macros)]);
    skipSpace(cursor);
    const next = cursor.text[cursor.at];
    if (next !== "," && next !== close) throw new BibSyntaxError("expected a comma");
  }
}

function skipGroup(cursor: Cursor, close: string) {
  const open = close === "}" ? "{" : "(";
  let depth = 1;
  while (cursor.at < cursor.text.length && depth > 0) {
    const char = cursor.text[cursor.at];
    if (char === open) depth += 1;
    else if (char === close) depth -= 1;
    cursor.at += 1;
  }
}

function citeKey(cursor: Cursor, close: string): string {
  const start = cursor.at;
  while (cursor.at < cursor.text.length && cursor.text[cursor.at] !== "," && cursor.text[cursor.at] !== close) cursor.at += 1;
  const key = cursor.text.slice(start, cursor.at).trim();
  if (!KEY.test(key)) throw new BibSyntaxError("bad key");
  return key;
}

function accentBase(raw: string, start: number): [string, number] {
  let index = start;
  while (raw[index] === " ") index += 1;
  if (raw[index] === "{") {
    const cursor = { text: raw, at: index };
    try {
      const inner = braced(cursor);
      return [decodeLatex(inner), cursor.at];
    } catch {
      return ["", raw.length];
    }
  }
  if (raw[index] === "\\") {
    const match = /^\\[A-Za-z]+/.exec(raw.slice(index));
    if (match) return [decodeLatex(match[0]), index + match[0].length];
  }
  return [raw[index] ?? "", index + 1];
}

function accented(mark: string, base: string): string {
  if (!base) return "";
  const first = Array.from(base)[0];
  return `${DOTLESS[first] ?? first}${ACCENTS[mark]}${base.slice(first.length)}`;
}

export function decodeLatex(raw: string): string {
  let out = "";
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (char === "\\") {
      const next = raw[index + 1] ?? "";
      if (ESCAPED.has(next)) {
        out += next;
        index += 2;
      } else if (next === "\\" || SPACING.has(next)) {
        out += " ";
        index += 2;
      } else if (next === "-" || next === "/" || next === "!") {
        index += 2;
      } else if (next in ACCENTS && !/[A-Za-z]/.test(next)) {
        const [base, end] = accentBase(raw, index + 2);
        out += accented(next, base);
        index = end;
      } else {
        const name = /^[A-Za-z]+/.exec(raw.slice(index + 1))?.[0];
        if (!name) {
          index += 1;
          continue;
        }
        let end = index + 1 + name.length;
        if (name.length === 1 && name in ACCENTS) {
          const [base, after] = accentBase(raw, end);
          out += accented(name, base);
          index = after;
          continue;
        }
        if (name in SYMBOLS) {
          out += SYMBOLS[name];
          if (raw.startsWith("{}", end)) end += 2;
          else if (raw[end] === " ") end += 1;
        } else {
          let probe = end;
          while (raw[probe] === " ") probe += 1;
          if (raw[probe] === "{") end = probe;
        }
        index = end;
      }
      continue;
    }
    if (char === "{" || char === "}" || char === "$") {
      index += 1;
    } else if (char === "~") {
      out += "\u00a0";
      index += 1;
    } else if (raw.startsWith("---", index)) {
      out += "—";
      index += 3;
    } else if (raw.startsWith("--", index)) {
      out += "–";
      index += 2;
    } else if (raw.startsWith("``", index)) {
      out += "“";
      index += 2;
    } else if (raw.startsWith("''", index)) {
      out += "”";
      index += 2;
    } else {
      out += char;
      index += 1;
    }
  }
  return out.replace(/\s+/g, " ").trim().normalize("NFC");
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
  if (!raw.startsWith("{") || !raw.endsWith("}")) return false;
  const cursor = { text: raw, at: 0 };
  try {
    braced(cursor);
  } catch {
    return false;
  }
  return cursor.at === raw.length;
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
  if (parts.length >= 2) return { family: decodeLatex(parts[0]), given: decodeLatex(parts[parts.length - 1]) };
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

function verbatim(raw: string): string {
  return raw.replace(/\\([_%&#~$])/g, "$1").replace(/[{}\s]/g, "");
}

function entryOf(type: string, key: string, pairs: [string, string][]): BibEntry {
  const entry: BibEntry = { key, type, fields: {}, authors: [], editors: [] };
  for (const [name, raw] of pairs.slice(0, MAX_FIELDS)) {
    const text = raw.slice(0, MAX_FIELD_CHARS);
    if (name === "author") entry.authors = parseNames(text);
    else if (name === "editor") entry.editors = parseNames(text);
    else {
      const decoded = VERBATIM_FIELDS.has(name) ? verbatim(text) : decodeLatex(text);
      if (decoded) entry.fields[name] = decoded;
    }
  }
  return entry;
}

export function parseBibtex(text: string): BibParseResult {
  const macros = new Map(Object.entries(MONTHS));
  const entries: BibEntry[] = [];
  const keys = new Set<string>();
  const cursor: Cursor = { text, at: 0 };
  let skipped = 0;
  let duplicates = 0;
  while (entries.length < MAX_SOURCES) {
    const start = text.indexOf("@", cursor.at);
    if (start < 0) break;
    cursor.at = start + 1;
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
        for (const [name, raw] of assignments(cursor, close, macros)) macros.set(name, raw);
        continue;
      }
      const key = citeKey(cursor, close);
      const entry = entryOf(type, key, assignments(cursor, close, macros));
      if (keys.has(key.toLowerCase())) duplicates += 1;
      else {
        keys.add(key.toLowerCase());
        entries.push(entry);
      }
    } catch (error) {
      if (!(error instanceof BibSyntaxError)) throw error;
      skipped += 1;
    }
  }
  return { entries, skipped, duplicates };
}

function cleanName(value: unknown): BibName | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const family = typeof source.family === "string" ? source.family.slice(0, 300) : "";
  const given = typeof source.given === "string" ? source.given.slice(0, 300) : "";
  if (source.others === true) return { family: "", given: "", others: true };
  if (!family && !given) return null;
  return source.literal === true ? { family, given, literal: true } : { family, given };
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
