import type { BibEntry, BibName, CitationLanguage } from "@/types/studio";
import { MAX_SOURCES, type BibParseResult } from "./bibtex";
import { bareDoi, claimKey, clip, keyBase, monthNumber, setField } from "./sourceKeys";

const MAX_NAMES = 200;

const TYPES_IN: Record<string, string> = {
  "article-journal": "article",
  "journal-article": "article",
  "article-magazine": "article",
  "article-newspaper": "article",
  periodical: "article",
  book: "book",
  classic: "book",
  "edited-book": "book",
  monograph: "book",
  "reference-book": "book",
  "book-set": "book",
  "book-series": "book",
  "book-track": "book",
  chapter: "incollection",
  "book-chapter": "incollection",
  "book-section": "incollection",
  "book-part": "incollection",
  "reference-entry": "incollection",
  "entry-encyclopedia": "incollection",
  "entry-dictionary": "incollection",
  "paper-conference": "inproceedings",
  "proceedings-article": "inproceedings",
  proceedings: "proceedings",
  thesis: "phdthesis",
  dissertation: "phdthesis",
  report: "techreport",
  "report-component": "techreport",
  "report-series": "techreport",
  dataset: "dataset",
  software: "software",
  webpage: "online",
  post: "online",
  "post-weblog": "online",
  manuscript: "unpublished",
  pamphlet: "booklet",
};

const PREPRINT_TYPES = new Set(["article", "posted-content"]);

const TYPES_OUT: Record<string, string> = {
  article: "article-journal",
  periodical: "article-journal",
  book: "book",
  mvbook: "book",
  manual: "book",
  collection: "book",
  proceedings: "book",
  booklet: "pamphlet",
  inbook: "chapter",
  incollection: "chapter",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  thesis: "thesis",
  techreport: "report",
  report: "report",
  online: "webpage",
  dataset: "dataset",
  software: "software",
  electronic: "webpage",
  www: "webpage",
  unpublished: "manuscript",
};

const CHAPTER_TYPES = new Set(["incollection", "inproceedings", "inbook"]);
const WHOLE_BOOKS = new Set(["book", "mvbook"]);

type CslName = { family?: string; given?: string; suffix?: string; literal?: string };
type CslItem = Record<string, unknown>;

function text(value: unknown): string {
  return clip(value);
}

const TURKISH_CAPITALS = /[ŞĞİ]/;
const TURKISH_LETTERS = /[ğĞşŞıİ]/;
const NICKNAME = /\s*\([^()]*\)/g;
const UNTITLECASED_LANGUAGE = "und";
const TURKISH_LANGUAGE = /^(?:tr|tur|turkish|türkçe)\b/i;

const THESIS_GENRES: Record<string, { mastersthesis: string; phdthesis: string }> = {
  tr: { mastersthesis: "Yüksek lisans tezi", phdthesis: "Doktora tezi" },
  de: { mastersthesis: "Masterarbeit", phdthesis: "Dissertation" },
  es: { mastersthesis: "Tesis de maestría", phdthesis: "Tesis doctoral" },
  fr: { mastersthesis: "Mémoire de master", phdthesis: "Thèse de doctorat" },
  it: { mastersthesis: "Tesi di laurea magistrale", phdthesis: "Tesi di dottorato" },
  pt: { mastersthesis: "Dissertação de mestrado", phdthesis: "Tese de doutorado" },
  ar: { mastersthesis: "رسالة ماجستير", phdthesis: "أطروحة دكتوراه" },
};

function unshouted(name: string, turkish: boolean): string {
  if (name.length < 2 || name !== name.toLocaleUpperCase("tr") || name === name.toLocaleLowerCase("tr")) return name;
  const locale = turkish || TURKISH_CAPITALS.test(name) ? "tr" : "en";
  return name.toLocaleLowerCase(locale).replace(/(^|[\s\-'’])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase(locale));
}

function within<T>(items: T[]): T[] {
  return items.length > MAX_NAMES ? [...items.slice(0, MAX_NAMES - 1), items[items.length - 1]] : items;
}

function namesOf(value: unknown, turkish: boolean): BibName[] {
  if (!Array.isArray(value)) return [];
  const names: BibName[] = [];
  for (const item of within(value)) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const literal = text(source.literal) || text(source.name);
    if (literal) {
      names.push({ family: literal, given: "", literal: true });
      continue;
    }
    const family = [text(source["dropping-particle"]), text(source["non-dropping-particle"]), unshouted(text(source.family), turkish)].filter(Boolean).join(" ");
    const given = unshouted(text(source.given).replace(NICKNAME, "").trim(), turkish);
    const suffix = text(source.suffix);
    if (family || given) names.push({ family: family || given, given: family ? given : "", ...(suffix ? { suffix } : {}) });
  }
  return names;
}

function firstName(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : null;
  return first && typeof first === "object" ? text((first as Record<string, unknown>).name) : "";
}

function dateOf(value: unknown): { year: string; month: number | null; full: string } {
  if (!value || typeof value !== "object") return { year: "", month: null, full: "" };
  const source = value as Record<string, unknown>;
  const parts = Array.isArray(source["date-parts"]) && Array.isArray(source["date-parts"][0]) ? (source["date-parts"][0] as unknown[]) : [];
  if (parts.length > 0) {
    const [year, month, day] = parts.map((part) => text(part));
    const monthValue = month ? monthNumber(month) : null;
    const full = [year, monthValue ? String(monthValue).padStart(2, "0") : "", monthValue && day ? day.padStart(2, "0") : ""].filter(Boolean).join("-");
    return { year: /^-?\d+$/.test(year) ? year : "", month: monthValue, full };
  }
  const raw = text(source.raw) || text(source.literal);
  const match = /(\d{4})(?:[-/](\d{1,2}))?/.exec(raw);
  return { year: match?.[1] ?? raw, month: match?.[2] ? monthNumber(match[2]) : null, full: raw };
}

function entryOf(item: CslItem, taken: Set<string>): BibEntry {
  const cslType = text(item.type);
  const genre = text(item.genre);
  const preprint = PREPRINT_TYPES.has(cslType);
  const thesis = TYPES_IN[cslType] === "phdthesis";
  const type = preprint ? "online" : thesis && /master|yüksek lisans/i.test(genre) ? "mastersthesis" : (TYPES_IN[cslType] ?? "misc");
  const turkish = /^tr\b/i.test(text(item.language)) || TURKISH_LETTERS.test(`${text(item.title)} ${text(item["container-title"])}`);
  const authors = namesOf(item.author, turkish);
  const editors = namesOf(item.editor, turkish);
  const issued = dateOf(item.issued);
  const subtitle = text(Array.isArray(item.subtitle) ? item.subtitle[0] : item.subtitle);
  const mainTitle = text(Array.isArray(item.title) ? item.title[0] : item.title);
  const title = subtitle && !mainTitle.toLowerCase().includes(subtitle.toLowerCase()) ? `${mainTitle.replace(/[:.]\s*$/, "")}: ${subtitle}` : mainTitle;
  const entry: BibEntry = { key: "", type, fields: {}, authors, editors };
  setField(entry, "title", title);
  setField(entry, "year", issued.year);
  if (issued.month) setField(entry, "month", String(issued.month));
  const container = text(Array.isArray(item["container-title"]) ? item["container-title"][0] : item["container-title"]);
  if (type === "article") setField(entry, "journal", container);
  else if (CHAPTER_TYPES.has(type)) setField(entry, "booktitle", container);
  else setField(entry, "series", container);
  setField(entry, "series", item["collection-title"]);
  if (type === "article") setField(entry, "shortjournal", item["container-title-short"]);
  setField(entry, "volume", item.volume);
  const page = clip(item.page);
  const articleNumber = clip(item["article-number"]) || (type === "article" ? clip(item.number) || (/^e\d+$/i.test(page) ? page : "") : "");
  setField(entry, "number", type === "article" ? item.issue : (item.issue ?? item.number));
  if (articleNumber) setField(entry, "eid", articleNumber);
  if (!articleNumber || page !== articleNumber) setField(entry, "pages", page);
  if (preprint) {
    setField(entry, "pubstate", "preprint");
    setField(entry, "eprinttype", firstName(item.institution) || text(item.archive) || text(item.publisher));
  }
  setField(entry, "version", item.version);
  setField(entry, thesis || type === "mastersthesis" ? "school" : type === "techreport" ? "institution" : "publisher", item.publisher);
  setField(entry, "address", item["publisher-place"]);
  setField(entry, "edition", item.edition);
  setField(entry, "doi", item.DOI);
  setField(entry, "url", item.URL);
  setField(entry, "isbn", item.ISBN);
  setField(entry, "issn", item.ISSN);
  setField(entry, "abstract", item.abstract);
  setField(entry, "keywords", item.keyword);
  setField(entry, "note", item.note);
  setField(entry, "language", item.language);
  setField(entry, "urldate", dateOf(item.accessed).full);
  if (genre && type === "phdthesis" && !/ph\.?\s?d|doctor|doktora/i.test(genre)) setField(entry, "type", genre);
  if (type === "techreport" && genre) setField(entry, "type", genre);
  entry.key = claimKey(text(item.id) || text(item["citation-key"]), keyBase(authors, issued.year, title), taken);
  return entry;
}

export function parseCslJson(raw: string): BibParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return { entries: [], skipped: 1, duplicates: 0 };
  }
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : [parsed];
  const taken = new Set<string>();
  const entries: BibEntry[] = [];
  let skipped = 0;
  for (const item of items) {
    if (entries.length >= MAX_SOURCES) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) skipped += 1;
    else entries.push(entryOf(item as CslItem, taken));
  }
  return { entries, skipped, duplicates: 0 };
}

function cslNames(names: BibName[]): CslName[] {
  return names
    .filter((name) => !name.others)
    .map((name) => (name.literal ? { literal: name.family } : { family: name.family, ...(name.given ? { given: name.given } : {}), ...(name.suffix ? { suffix: name.suffix } : {}) }));
}

function issuedOf(entry: BibEntry): { "date-parts": number[][] } | { literal: string } | undefined {
  if (!entry.fields.year && entry.fields.date) {
    const dated = accessedOf(entry.fields.date);
    if (dated) return dated;
  }
  const year = entry.fields.year || /^\d{4}/.exec(entry.fields.date ?? "")?.[0] || "";
  if (!year) return undefined;
  if (!/^-?\d+$/.test(year)) return { literal: year };
  const month = monthNumber(entry.fields.month ?? "");
  return { "date-parts": [month ? [Number(year), month] : [Number(year)]] };
}

function titleOf(title: string | undefined, subtitle: string | undefined): string | undefined {
  if (!title || !subtitle) return title ?? subtitle;
  return `${title}${/[.:?!]$/.test(title) ? "" : ":"} ${subtitle}`;
}

function accessedOf(value: string): { "date-parts": number[][] } | undefined {
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(value);
  if (!match) return undefined;
  return { "date-parts": [match.slice(1).filter(Boolean).map(Number)] };
}

export function isPreprint(entry: BibEntry): boolean {
  if (!["online", "misc", "unpublished", "article"].includes(entry.type)) return false;
  return entry.fields.pubstate === "preprint" || Boolean(entry.fields.archiveprefix) || (entry.type !== "article" && Boolean(entry.fields.eprinttype));
}

export function cslItemOf(entry: BibEntry): CslItem {
  const field = (name: string) => entry.fields[name] || undefined;
  const preprint = isPreprint(entry);
  const journal = entry.type === "article" && !preprint;
  const seriesAsJournal = WHOLE_BOOKS.has(entry.type) && !field("series") && !field("booktitle") ? field("journal") : undefined;
  const item: CslItem = {
    id: entry.key,
    type: preprint ? "article" : (TYPES_OUT[entry.type] ?? "document"),
    title: titleOf(field("title"), field("subtitle")),
    author: entry.authors.length > 0 ? cslNames(entry.authors) : undefined,
    editor: entry.editors.length > 0 ? cslNames(entry.editors) : undefined,
    issued: issuedOf(entry),
    "container-title": seriesAsJournal ? undefined : (field("journal") ?? field("journaltitle") ?? field("booktitle")),
    "container-title-short": field("shortjournal"),
    "collection-title": field("series") ?? seriesAsJournal,
    volume: field("volume"),
    issue: journal ? (field("number") ?? field("issue")) : field("issue"),
    number: journal ? field("eid") : entry.type === "techreport" ? field("number") : field("eid"),
    "collection-number": journal || entry.type === "techreport" ? undefined : field("number"),
    page: field("pages"),
    publisher: preprint ? (field("eprinttype") ?? field("archiveprefix") ?? field("publisher") ?? field("organization")) : (field("publisher") ?? field("school") ?? field("institution") ?? field("organization")),
    "publisher-place": field("address") ?? field("location"),
    edition: field("edition"),
    version: field("version"),
    genre: field("type") ?? (entry.type === "mastersthesis" ? "Master's thesis" : entry.type === "phdthesis" ? "PhD thesis" : preprint ? "Preprint" : undefined),
    DOI: entry.fields.doi ? bareDoi(entry.fields.doi) || undefined : undefined,
    URL: field("url"),
    ISBN: field("isbn"),
    ISSN: field("issn"),
    abstract: field("abstract"),
    keyword: field("keywords"),
    note: field("note"),
    language: field("language"),
    accessed: accessedOf(entry.fields.urldate ?? ""),
  };
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
}

function shownName(name: CslName, turkish: boolean): CslName {
  if (!name.family) return name;
  const given = name.given?.replace(NICKNAME, "").trim();
  const shownGiven = given && given.replace(/[^\p{L}]/gu, "").length > 2 ? unshouted(given, turkish) : given;
  return { ...name, family: unshouted(name.family, turkish), ...(shownGiven ? { given: shownGiven } : {}) };
}

export function shownItemOf(entry: BibEntry, citationLanguage: CitationLanguage = "en-US"): CslItem {
  const item = cslItemOf(entry);
  const language = entry.fields.language ?? entry.fields.langid ?? "";
  const turkish = TURKISH_LANGUAGE.test(language) || TURKISH_LETTERS.test(`${entry.fields.title ?? ""} ${entry.fields.journal ?? entry.fields.booktitle ?? ""}`);
  for (const role of ["author", "editor"]) {
    const names = item[role];
    if (Array.isArray(names)) item[role] = names.map((name: CslName) => shownName(name, turkish));
  }
  if (turkish && (!entry.fields.language || TURKISH_LANGUAGE.test(entry.fields.language))) item.language = citationLanguage === "tr-TR" ? "tr" : UNTITLECASED_LANGUAGE;
  const genres = THESIS_GENRES[citationLanguage.split("-")[0]];
  if (genres && !entry.fields.type && (entry.type === "mastersthesis" || entry.type === "phdthesis")) item.genre = genres[entry.type];
  return item;
}

export function writeCslJson(entries: BibEntry[]): string {
  return `${JSON.stringify(entries.map(cslItemOf), null, 2)}\n`;
}
