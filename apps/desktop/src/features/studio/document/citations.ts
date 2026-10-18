import type { BibEntry, BibName, CitationStyle, DocumentNode } from "@/types/studio";
import { CITATION, citationItems, type CitationItem } from "./citationItems";
import { FOOTNOTE, footnoteCitations, footnoteMarkup } from "./footnotes";
import { escapeHtml } from "./toHtml";

export const CITATION_STYLES: CitationStyle[] = ["apa", "mla", "chicago", "ieee"];
const APA_LIST_LIMIT = 20;
const CHICAGO_LIST_LIMIT = 10;
const IEEE_LIST_LIMIT = 6;
const SHORT_TITLE_WORDS = 4;
const WEB_LINK = /^https?:\/\//i;

export type CitationTerms = {
  and: string;
  etAl: string;
  page: string;
  pages: string;
  noDate: string;
  in: string;
  editor: string;
  editors: string;
  editedBy: string;
  edition: string;
  volume: string;
  issue: string;
  doctoral: string;
  masters: string;
  thesis: string;
  report: string;
  available: string;
};

export type CitationLabel = { text: string; missing: boolean };

export type Citations = { style: CitationStyle; label: (items: CitationItem[]) => CitationLabel; references: string[] };

type Kind = "article" | "book" | "chapter" | "thesis" | "report" | "other";

type Work = {
  entry: BibEntry;
  names: BibName[];
  byEditors: boolean;
  year: string;
  dated: string;
  number: number;
};

const KINDS: Record<string, Kind> = {
  article: "article",
  periodical: "article",
  book: "book",
  mvbook: "book",
  booklet: "book",
  manual: "book",
  proceedings: "book",
  collection: "book",
  inbook: "chapter",
  incollection: "chapter",
  inproceedings: "chapter",
  conference: "chapter",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  thesis: "thesis",
  techreport: "report",
  report: "report",
};

function kindOf(entry: BibEntry): Kind {
  return KINDS[entry.type] ?? "other";
}

export function citedKeys(content: DocumentNode | string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (items: CitationItem[]) => {
    for (const item of items) {
      const key = item.key.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  };
  const visit = (node: DocumentNode) => {
    if (node.type === CITATION) add(citationItems(node.attrs?.items));
    if (node.type === FOOTNOTE) footnoteCitations(footnoteMarkup(node.attrs?.html)).forEach(add);
    for (const child of node.content ?? []) visit(child);
  };
  if (typeof content !== "string") visit(content);
  return keys;
}

const e = escapeHtml;

function em(value: string): string {
  return value ? `<em>${e(value)}</em>` : "";
}

function visible(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "x")
    .trimEnd();
}

function stop(html: string, mark = "."): string {
  if (!html) return "";
  return /[.?!][”’"]?$/.test(visible(html)) ? html : `${html}${mark}`;
}

function sentences(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => stop(part))
    .join(" ");
}

function list(parts: string[], separator = ", "): string {
  return parts.filter(Boolean).join(separator);
}

function quote(title: string, mark = ""): string {
  if (!title) return "";
  const ends = /[.?!]$/.test(title);
  return `“${e(title)}${ends ? "" : mark}”`;
}

function link(url: string): string {
  if (!url) return "";
  return WEB_LINK.test(url) ? `<a href="${e(url)}">${e(url)}</a>` : e(url);
}

function field(entry: BibEntry, ...names: string[]): string {
  for (const name of names) {
    const value = entry.fields[name];
    if (value) return value;
  }
  return "";
}

function yearOf(entry: BibEntry): string {
  const year = field(entry, "year");
  if (year) return year;
  return /^\d{4}/.exec(field(entry, "date"))?.[0] ?? "";
}

function pagesOf(entry: BibEntry): string {
  return field(entry, "pages").replace(/\s*(?:-{1,3}|–|—)\s*/g, "–");
}

function containerOf(entry: BibEntry): string {
  return field(entry, "journal", "journaltitle", "booktitle", "maintitle");
}

function webOf(entry: BibEntry): string {
  const doi = field(entry, "doi");
  if (doi) return `https://doi.org/${doi.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/i, "")}`;
  return field(entry, "url");
}

function publisherOf(entry: BibEntry): string {
  return field(entry, "publisher", "organization", "institution", "school", "howpublished");
}

function placeOf(entry: BibEntry): string {
  return field(entry, "address", "location");
}

function englishOrdinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
}

function editionOf(entry: BibEntry, terms: CitationTerms): string {
  const edition = field(entry, "edition");
  if (!edition || edition === "1") return "";
  const value = Number(edition);
  if (!Number.isInteger(value)) return edition;
  return terms.edition.replace("{ord}", englishOrdinal(value)).replace("{n}", String(value));
}

function thesisLabel(entry: BibEntry, terms: CitationTerms): string {
  if (entry.type === "phdthesis") return terms.doctoral;
  if (entry.type === "mastersthesis") return terms.masters;
  return field(entry, "type") || terms.thesis;
}

function people(names: BibName[]): BibName[] {
  return names.filter((name) => !name.others);
}

function initials(given: string): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split("-")
        .map((piece) => {
          const first = Array.from(piece)[0];
          return first ? `${first}.` : "";
        })
        .join("-"),
    )
    .join(" ");
}

function inverted(name: BibName, short: boolean): string {
  if (name.literal || !name.given) return name.family;
  return `${name.family}, ${short ? initials(name.given) : name.given}`;
}

function natural(name: BibName, short: boolean): string {
  if (name.literal || !name.given) return name.family;
  return `${short ? initials(name.given) : name.given} ${name.family}`;
}

function series(parts: string[], and: string, serialComma: boolean): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]}${serialComma ? "," : ""} ${and} ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, ${and} ${parts[parts.length - 1]}`;
}

function apaNames(names: BibName[]): string {
  const all = people(names).map((name) => inverted(name, true));
  if (all.length > APA_LIST_LIMIT) return `${all.slice(0, APA_LIST_LIMIT - 1).join(", ")}, . . . ${all[all.length - 1]}`;
  return series(all, "&", true);
}

function apaEditors(names: BibName[]): string {
  return series(
    people(names).map((name) => natural(name, true)),
    "&",
    false,
  );
}

function mlaNames(names: BibName[], terms: CitationTerms): string {
  const all = people(names);
  if (all.length === 0) return "";
  if (all.length >= 3 || names.some((name) => name.others)) return `${inverted(all[0], false)}, ${terms.etAl}`;
  return series([inverted(all[0], false), ...all.slice(1).map((name) => natural(name, false))], terms.and, true);
}

function chicagoNames(names: BibName[], terms: CitationTerms): string {
  const all = people(names);
  if (all.length === 0) return "";
  const shown = all.length > CHICAGO_LIST_LIMIT ? all.slice(0, 7) : all;
  const parts = [inverted(shown[0], false), ...shown.slice(1).map((name) => natural(name, false))];
  return shown.length < all.length ? `${parts.join(", ")}, ${terms.etAl}` : series(parts, terms.and, true);
}

function ieeeNames(names: BibName[], terms: CitationTerms): string {
  const all = people(names);
  if (all.length > IEEE_LIST_LIMIT) return `${natural(all[0], true)} ${terms.etAl}`;
  return series(
    all.map((name) => natural(name, true)),
    terms.and,
    all.length > 2,
  );
}

function plainNames(names: BibName[], terms: CitationTerms): string {
  return series(
    people(names).map((name) => natural(name, false)),
    terms.and,
    false,
  );
}

function editorTerm(names: BibName[], terms: CitationTerms): string {
  return people(names).length > 1 ? terms.editors : terms.editor;
}

function shortTitle(entry: BibEntry): string {
  const words = field(entry, "shorttitle", "title").split(/\s+/).filter(Boolean);
  const short = words.slice(0, SHORT_TITLE_WORDS).join(" ");
  return short ? `“${short}${words.length > SHORT_TITLE_WORDS ? "…" : ""}”` : "";
}

function citedNames(work: Work, style: CitationStyle, terms: CitationTerms): string {
  const all = people(work.names);
  if (all.length === 0) return shortTitle(work.entry);
  const family = all.map((name) => name.family);
  const etAl = `${family[0]} ${terms.etAl}`;
  if (style === "apa") return family.length === 1 ? family[0] : family.length === 2 ? `${family[0]} & ${family[1]}` : etAl;
  if (style === "chicago" && family.length === 3) return series(family, terms.and, true);
  if (family.length >= 3 || work.names.some((name) => name.others)) return etAl;
  return family.length === 1 ? family[0] : `${family[0]} ${terms.and} ${family[1]}`;
}

function sortName(work: Work): string {
  const first = people(work.names)[0];
  return first ? `${first.family} ${first.given}` : field(work.entry, "title");
}

function pageLocator(locator: string, terms: CitationTerms, prefixed: boolean): string {
  const text = locator.trim();
  if (!text) return "";
  if (!prefixed || !/^\d/.test(text)) return text;
  return `${/[-–,]/.test(text) ? terms.pages : terms.page} ${text.replace(/\s*-{1,2}\s*/g, "–")}`;
}

function apa(work: Work, terms: CitationTerms): string {
  const { entry } = work;
  const kind = kindOf(entry);
  const title = field(entry, "title");
  const italicTitle = kind === "article" || kind === "chapter" ? e(title) : em(title);
  const names = apaNames(work.names);
  const head = names ? `${e(names)}${work.byEditors ? ` (${e(editorTerm(work.names, terms))})` : ""}` : italicTitle;
  const start = `${stop(head)} (${e(work.dated)}).`;
  const body = names ? italicTitle : "";
  const web = link(webOf(entry));
  const pages = pagesOf(entry);
  const edition = editionOf(entry, terms);
  let rest: string;
  if (kind === "article") {
    const volume = field(entry, "volume");
    const issue = field(entry, "number", "issue");
    const numbering = `${em(volume)}${issue ? `(${e(issue)})` : ""}`;
    rest = sentences(body, list([em(containerOf(entry)), numbering, e(pages)]));
  } else if (kind === "chapter") {
    const editors = people(entry.editors).length ? `${e(apaEditors(entry.editors))} (${e(editorTerm(entry.editors, terms))}), ` : "";
    const inside = `${e(terms.in)} ${editors}${em(containerOf(entry))}${pages ? ` (${e(terms.pages)} ${e(pages)})` : ""}`;
    rest = sentences(body, inside, e(field(entry, "publisher")));
  } else if (kind === "thesis") {
    const label = list([e(thesisLabel(entry, terms)), e(field(entry, "school", "institution"))]);
    rest = sentences(`${body}${label ? ` [${label}]` : ""}`);
  } else if (kind === "report") {
    const number = field(entry, "number");
    rest = sentences(`${body}${number ? ` (${e(terms.report)} ${e(number)})` : ""}`, e(field(entry, "institution", "publisher")));
  } else {
    rest = sentences(`${body}${edition ? ` (${e(edition)})` : ""}`, e(publisherOf(entry)));
  }
  return [start, rest, web].filter(Boolean).join(" ");
}

function mla(work: Work, terms: CitationTerms): string {
  const { entry } = work;
  const kind = kindOf(entry);
  const title = field(entry, "title");
  const names = mlaNames(work.names, terms);
  const head = names ? `${e(names)}${work.byEditors ? `, ${e(editorTerm(work.names, terms))}` : ""}` : "";
  const pages = pagesOf(entry);
  const numbered = (term: string, value: string) => (value ? `${e(term)} ${e(value)}` : "");
  const titled = kind === "book" || kind === "thesis" || kind === "report" || kind === "other" ? stop(em(title)) : quote(title, ".");
  const editors = people(entry.editors).length && !work.byEditors ? `${e(terms.editedBy)} ${e(plainNames(entry.editors, terms))}` : "";
  let container: string;
  if (kind === "article") container = list([em(containerOf(entry)), numbered(terms.volume, field(entry, "volume")), numbered(terms.issue, field(entry, "number", "issue")), e(work.year), numbered(terms.pages, pages)]);
  else if (kind === "chapter") container = list([em(containerOf(entry)), editors, e(field(entry, "publisher")), e(work.year), numbered(terms.pages, pages)]);
  else if (kind === "thesis") container = list([e(field(entry, "school", "institution")), e(thesisLabel(entry, terms)), e(work.year)]);
  else container = list([e(editionOf(entry, terms)), editors, e(publisherOf(entry)), e(work.year)]);
  return sentences(head, titled, container, link(webOf(entry)).replace(/\.$/, ""));
}

function chicago(work: Work, terms: CitationTerms): string {
  const { entry } = work;
  const kind = kindOf(entry);
  const title = field(entry, "title");
  const names = chicagoNames(work.names, terms);
  const head = names ? `${e(names)}${work.byEditors ? `, ${e(editorTerm(work.names, terms))}` : ""}` : "";
  const pages = pagesOf(entry);
  const imprint = list([e(placeOf(entry)), e(publisherOf(entry))], ": ");
  let parts: string[];
  if (kind === "article") {
    const volume = field(entry, "volume");
    const issue = field(entry, "number", "issue");
    parts = [quote(title, "."), `${em(containerOf(entry))}${volume ? ` ${e(volume)}` : ""}${issue ? ` (${e(issue)})` : ""}${pages ? `: ${e(pages)}` : ""}`];
  } else if (kind === "chapter") {
    const editors = people(entry.editors).length ? `${e(terms.editedBy)} ${e(plainNames(entry.editors, terms))}` : "";
    parts = [quote(title, "."), `${e(terms.in)} ${list([em(containerOf(entry)), editors, e(pages)])}`, imprint];
  } else if (kind === "thesis") {
    parts = [quote(title, "."), list([e(thesisLabel(entry, terms)), e(field(entry, "school", "institution"))])];
  } else {
    parts = [em(title), e(editionOf(entry, terms)), imprint];
  }
  const [titled, ...rest] = parts;
  const opening = head ? sentences(head, e(work.dated), titled) : sentences(titled, e(work.dated));
  return [opening, sentences(...rest), link(webOf(entry))].filter(Boolean).join(" ");
}

function ieee(work: Work, terms: CitationTerms): string {
  const { entry } = work;
  const kind = kindOf(entry);
  const title = field(entry, "title");
  const names = ieeeNames(work.names, terms);
  const head = names ? `${e(names)}${work.byEditors ? `, ${e(editorTerm(work.names, terms))}` : ""}` : "";
  const pages = pagesOf(entry);
  const numbered = (term: string, value: string) => (value ? `${e(term)} ${e(value)}` : "");
  const place = e(placeOf(entry));
  const quoted = (rest: string[]) => {
    const tail = list(rest);
    const lead = list([head, quote(title, tail ? "," : "")]);
    return tail ? `${lead} ${tail}` : lead;
  };
  let body: string;
  if (kind === "article") body = quoted([em(containerOf(entry)), numbered(terms.volume, field(entry, "volume")), numbered(terms.issue, field(entry, "number", "issue")), numbered(terms.pages, pages), e(work.year)]);
  else if (kind === "chapter") {
    const editors = people(entry.editors).length ? `${e(ieeeNames(entry.editors, terms))}, ${e(editorTerm(entry.editors, terms))}` : "";
    body = quoted([`${e(terms.in)} ${em(containerOf(entry))}`, editors, place, e(field(entry, "publisher")), e(work.year), numbered(terms.pages, pages)]);
  } else if (kind === "thesis") body = quoted([e(thesisLabel(entry, terms)), e(field(entry, "school", "institution")), place, e(work.year)]);
  else if (kind === "report") body = quoted([e(field(entry, "institution", "publisher")), place, numbered(terms.report, field(entry, "number")), e(work.year)]);
  else {
    const imprint = list([place, list([e(publisherOf(entry)), e(work.year)])], ": ");
    const lead = list([head, em(title), e(editionOf(entry, terms))]);
    body = imprint ? `${stop(lead)} ${imprint}` : lead;
  }
  const web = webOf(entry);
  return `${stop(body)}${web ? ` ${e(terms.available)}: ${link(web)}` : ""}`;
}

const FORMATS: Record<CitationStyle, (work: Work, terms: CitationTerms) => string> = { apa, mla, chicago, ieee };

function suffix(position: number): string {
  return String.fromCharCode(97 + (position % 26));
}

export function buildCitations(content: DocumentNode | string, sources: BibEntry[], style: CitationStyle, terms: CitationTerms, locale: string): Citations {
  const byKey = new Map(sources.map((entry) => [entry.key.toLowerCase(), entry]));
  const cited = citedKeys(content).filter((key) => byKey.has(key));
  const chosen = cited.length ? cited.map((key) => byKey.get(key) as BibEntry) : sources;
  const collator = new Intl.Collator(locale || undefined, { sensitivity: "base", numeric: true });
  let works: Work[] = chosen.map((entry) => {
    const byEditors = people(entry.authors).length === 0 && people(entry.editors).length > 0;
    const year = yearOf(entry);
    return { entry, names: byEditors ? entry.editors : entry.authors, byEditors, year, dated: year || terms.noDate, number: 0 };
  });
  if (style !== "ieee") {
    works = [...works].sort((a, b) => collator.compare(sortName(a), sortName(b)) || collator.compare(a.year, b.year) || collator.compare(field(a.entry, "title"), field(b.entry, "title")));
  }
  if (style === "apa" || style === "chicago") {
    const groups = new Map<string, Work[]>();
    for (const work of works) {
      const label = `${citedNames(work, style, terms)}|${work.year}`;
      groups.set(label, [...(groups.get(label) ?? []), work]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.forEach((work, position) => {
        work.dated = work.year ? `${work.year}${suffix(position)}` : `${terms.noDate}-${suffix(position)}`;
      });
    }
  }
  works.forEach((work, position) => {
    work.number = position + 1;
  });
  const byWork = new Map(works.map((work) => [work.entry.key.toLowerCase(), work]));
  const references = works.map((work) => (style === "ieee" ? `[${work.number}]&nbsp;${FORMATS.ieee(work, terms)}` : FORMATS[style](work, terms)));

  const label = (items: CitationItem[]): CitationLabel => {
    let missing = items.length === 0;
    const parts = items.map((item) => {
      const work = byWork.get(item.key.toLowerCase());
      if (!work) {
        missing = true;
        return style === "ieee" ? "[?]" : `${item.key}?`;
      }
      if (style === "ieee") {
        const locator = pageLocator(item.locator, terms, true);
        return `[${work.number}${locator ? `, ${locator}` : ""}]`;
      }
      const names = citedNames(work, style, terms);
      if (style === "apa") return list([names, work.dated, pageLocator(item.locator, terms, true)]);
      if (style === "mla") return [names, pageLocator(item.locator, terms, false)].filter(Boolean).join(" ");
      return `${[names, work.dated].filter(Boolean).join(" ")}${item.locator ? `, ${pageLocator(item.locator, terms, false)}` : ""}`;
    });
    if (parts.length === 0) return { text: style === "ieee" ? "[?]" : "(?)", missing };
    return { text: style === "ieee" ? parts.join(", ") : `(${parts.join("; ")})`, missing };
  };

  return { style, label, references };
}

export function sourceSummary(entry: BibEntry): { names: string; year: string; title: string } {
  const names = people(entry.authors).length ? entry.authors : entry.editors;
  const family = people(names).map((name) => name.family);
  return {
    names: family.length > 2 ? `${family[0]} …` : family.join(", "),
    year: yearOf(entry),
    title: field(entry, "title") || containerOf(entry) || entry.key,
  };
}
