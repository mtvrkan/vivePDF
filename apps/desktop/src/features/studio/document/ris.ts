import type { BibEntry, BibName } from "@/types/studio";
import { MAX_SOURCES, type BibParseResult } from "./bibtex";
import { claimKey, clip, joinPages, keyBase, monthNumber, setField, splitPages } from "./sourceKeys";

const LINE = /^([A-Z][A-Z0-9]) {2}-(?: (.*))?$/;
const MAX_TAGS = 200;
const ISBN = /^(?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dX]$/i;
const GENERIC_TYPES = new Set(["GEN", "GENERIC"]);

const TYPES_IN: Record<string, string> = {
  JOUR: "article",
  JFULL: "article",
  EJOUR: "article",
  MGZN: "article",
  NEWS: "article",
  BOOK: "book",
  EBOOK: "book",
  EDBOOK: "book",
  CHAP: "incollection",
  ECHAP: "incollection",
  CPAPER: "inproceedings",
  CONF: "proceedings",
  THES: "phdthesis",
  RPRT: "techreport",
  ELEC: "online",
  WEB: "online",
  BLOG: "online",
  UNPB: "unpublished",
  PAMP: "booklet",
};

const TYPES_OUT: Record<string, string> = {
  article: "JOUR",
  periodical: "JOUR",
  book: "BOOK",
  mvbook: "BOOK",
  manual: "BOOK",
  collection: "EDBOOK",
  booklet: "PAMP",
  inbook: "CHAP",
  incollection: "CHAP",
  inproceedings: "CPAPER",
  conference: "CPAPER",
  proceedings: "CONF",
  phdthesis: "THES",
  mastersthesis: "THES",
  thesis: "THES",
  techreport: "RPRT",
  report: "RPRT",
  online: "ELEC",
  electronic: "ELEC",
  www: "ELEC",
  unpublished: "UNPB",
};

const CHAPTER_TYPES = new Set(["incollection", "inproceedings", "inbook"]);

type RisRecord = { type: string; tags: [string, string][] };

function nameOf(raw: string): BibName | null {
  const text = raw.trim();
  if (!text) return null;
  const parts = text.split(",").map((part) => part.trim());
  if (parts.length === 1) return /\s/.test(text) ? { family: text, given: "", literal: true } : { family: text, given: "" };
  return parts[2] ? { family: parts[0], given: parts[1] ?? "", suffix: parts[2] } : { family: parts[0], given: parts[1] ?? "" };
}

function entryOf(record: RisRecord, taken: Set<string>): BibEntry {
  const values = (...tags: string[]) => record.tags.filter(([tag]) => tags.includes(tag)).map(([, value]) => value.trim()).filter(Boolean);
  const first = (...tags: string[]) => values(...tags)[0] ?? "";
  const thesisKind = first("M3");
  const isbn = values("SN").find((value) => ISBN.test(value));
  const generic = first("SP") && first("T2", "BT") ? "incollection" : isbn ? "book" : "misc";
  const type = record.type === "THES" && /master|yüksek lisans/i.test(thesisKind) ? "mastersthesis" : (TYPES_IN[record.type] ?? (GENERIC_TYPES.has(record.type) ? generic : "misc"));
  const authors = values("AU", "A1").map(nameOf).filter((name): name is BibName => name !== null);
  const editors = values("ED", "A2").map(nameOf).filter((name): name is BibName => name !== null);
  const dated = first("PY", "Y1", "DA");
  const year = /\d{4}/.exec(dated)?.[0] ?? "";
  const title = first("TI", "T1", "CT");
  const entry: BibEntry = { key: "", type, fields: {}, authors, editors };
  setField(entry, "title", title);
  setField(entry, "year", year);
  const month = monthNumber(dated.split("/")[1] ?? "") ?? monthNumber(first("DA").split("/")[1] ?? "");
  if (month) setField(entry, "month", String(month));
  const container = first("T2", "JF", "JO", "BT", "JA");
  if (type === "article") setField(entry, "journal", container);
  else if (CHAPTER_TYPES.has(type)) setField(entry, "booktitle", container);
  else setField(entry, "series", container);
  setField(entry, "series", first("T3"));
  setField(entry, "volume", first("VL"));
  setField(entry, "number", first("IS", "M1"));
  setField(entry, "pages", joinPages(first("SP"), first("EP")));
  const publisher = first("PB");
  setField(entry, type.endsWith("thesis") ? "school" : type === "techreport" ? "institution" : "publisher", publisher);
  setField(entry, "address", first("CY", "PP"));
  setField(entry, "edition", first("ET"));
  setField(entry, "doi", first("DO"));
  setField(entry, "url", first("UR", "L2"));
  setField(entry, type === "article" ? "issn" : "isbn", type === "article" ? first("SN") : (isbn ?? first("SN")));
  setField(entry, "abstract", first("AB", "N2"));
  setField(entry, "keywords", values("KW").join(", "));
  setField(entry, "note", first("N1"));
  setField(entry, "language", first("LA"));
  if (thesisKind && type === "phdthesis" && !/ph\.?\s?d|doctor|doktora/i.test(thesisKind)) setField(entry, "type", thesisKind);
  entry.key = claimKey(first("ID"), keyBase(authors, year, title), taken);
  return entry;
}

export function parseRis(text: string): BibParseResult {
  const entries: BibEntry[] = [];
  const taken = new Set<string>();
  let current: RisRecord | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (entries.length >= MAX_SOURCES) break;
    const line = raw.replace(/^\uFEFF/, "");
    const match = LINE.exec(line.trimEnd());
    if (match) {
      const [, tag, value = ""] = match;
      if (tag === "TY") {
        if (current) entries.push(entryOf(current, taken));
        current = { type: value.trim().toUpperCase(), tags: [] };
      } else if (tag === "ER") {
        if (current) entries.push(entryOf(current, taken));
        current = null;
      } else if (current && current.tags.length < MAX_TAGS) current.tags.push([tag, value]);
    } else if (current && line.trim() && current.tags.length > 0) {
      const last = current.tags[current.tags.length - 1];
      last[1] = `${last[1]} ${line.trim()}`;
    }
  }
  if (current && entries.length < MAX_SOURCES) entries.push(entryOf(current, taken));
  return { entries, skipped: 0, duplicates: 0 };
}

function nameText(name: BibName): string {
  if (name.literal || !name.given) return name.family;
  return name.suffix ? `${name.family}, ${name.given}, ${name.suffix}` : `${name.family}, ${name.given}`;
}

function line(tag: string, value: string): string {
  return `${tag}  - ${clip(value)}`;
}

export function writeRis(entries: BibEntry[]): string {
  return entries
    .map((entry) => {
      const field = (name: string) => entry.fields[name] ?? "";
      const lines = [line("TY", TYPES_OUT[entry.type] ?? "GEN"), line("ID", entry.key)];
      for (const name of entry.authors) if (!name.others) lines.push(line("AU", nameText(name)));
      for (const name of entry.editors) if (!name.others) lines.push(line(CHAPTER_TYPES.has(entry.type) ? "A2" : "ED", nameText(name)));
      const add = (tag: string, value: string) => {
        if (value) lines.push(line(tag, value));
      };
      add("TI", field("title"));
      add("T2", field("journal") || field("journaltitle") || field("booktitle"));
      add("T3", field("series"));
      const month = monthNumber(field("month"));
      const year = field("year") || /^\d{4}/.exec(field("date"))?.[0] || "";
      add("PY", year);
      if (year && month) add("DA", `${year}/${String(month).padStart(2, "0")}`);
      add("VL", field("volume"));
      add("IS", field("number") || field("issue"));
      const [start, end] = splitPages(field("pages"));
      add("SP", start);
      add("EP", end);
      add("PB", field("publisher") || field("school") || field("institution") || field("organization"));
      add("CY", field("address") || field("location"));
      add("ET", field("edition"));
      add("DO", field("doi"));
      add("UR", field("url"));
      add("SN", field("isbn") || field("issn"));
      add("AB", field("abstract"));
      for (const keyword of field("keywords").split(/[,;]/)) add("KW", keyword.trim());
      add("N1", field("note"));
      add("LA", field("language"));
      if (entry.type === "mastersthesis") add("M3", field("type") || "Master's thesis");
      else if (entry.type === "phdthesis") add("M3", field("type") || "PhD thesis");
      lines.push("ER  - ");
      return lines.join("\n");
    })
    .join("\n\n")
    .concat(entries.length > 0 ? "\n" : "");
}
