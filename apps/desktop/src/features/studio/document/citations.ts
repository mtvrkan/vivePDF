import type { BibEntry, CitationLanguage, CitationStyle, DocumentNode } from "@/types/studio";
import { CITATION, citationItems, type CitationItem } from "./citationItems";
import { FOOTNOTE, footnoteCitations, footnoteMarkup } from "./footnotes";

export const CITATION_STYLES: CitationStyle[] = ["apa", "mla", "chicago", "chicago-notes", "ieee", "isnad", "isnad-notes", "vancouver", "harvard"];
export const CITATION_LANGUAGES: CitationLanguage[] = ["en-US", "en-GB", "tr-TR", "de-DE", "es-ES", "fr-FR", "it-IT", "pt-BR", "ar"];
const NOTE_STYLES = new Set<CitationStyle>(["chicago-notes", "isnad-notes"]);
const SENTENCE_CASE_STYLES = new Set<CitationStyle>(["apa", "vancouver", "harvard"]);
const UI_LANGUAGES: Record<string, CitationLanguage> = { en: "en-US", tr: "tr-TR", de: "de-DE", es: "es-ES", fr: "fr-FR", it: "it-IT", pt: "pt-BR", ar: "ar" };

export type CitationLabel = { text: string; html: string; missing: boolean };

export type Citations = {
  style: CitationStyle;
  notes: boolean;
  ready: boolean;
  label: (items: CitationItem[], ordinal?: number, inNote?: boolean) => CitationLabel;
  references: string[];
};

export type CitationCluster = { items: CitationItem[]; inNote: boolean; noteIndex: number };

export function isNoteStyle(style: CitationStyle): boolean {
  return NOTE_STYLES.has(style);
}

export function wantsSentenceCase(style: CitationStyle): boolean {
  return SENTENCE_CASE_STYLES.has(style);
}

export function citationLanguageOf(chosen: CitationLanguage | null | undefined, uiLanguage: string): CitationLanguage {
  if (chosen && CITATION_LANGUAGES.includes(chosen)) return chosen;
  if ((CITATION_LANGUAGES as string[]).includes(uiLanguage)) return uiLanguage as CitationLanguage;
  return UI_LANGUAGES[uiLanguage.toLowerCase().split(/[-_]/)[0]] ?? "en-US";
}

export function citationClusters(content: DocumentNode | string, notes: boolean): CitationCluster[] {
  const clusters: CitationCluster[] = [];
  let noteIndex = 0;
  const visit = (node: DocumentNode) => {
    if (node.type === CITATION) {
      if (notes) noteIndex += 1;
      clusters.push({ items: citationItems(node.attrs?.items), inNote: false, noteIndex: notes ? noteIndex : 0 });
    }
    if (node.type === FOOTNOTE) {
      noteIndex += 1;
      for (const items of footnoteCitations(footnoteMarkup(node.attrs?.html))) clusters.push({ items, inNote: true, noteIndex: notes ? noteIndex : 0 });
    }
    for (const child of node.content ?? []) visit(child);
  };
  if (typeof content !== "string") visit(content);
  return clusters;
}

export function citedKeys(content: DocumentNode | string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const cluster of citationClusters(content, false)) {
    for (const item of cluster.items) {
      const key = item.key.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

export function pendingCitations(style: CitationStyle): Citations {
  return { style, notes: isNoteStyle(style), ready: false, label: (items) => ({ text: "…", html: "…", missing: items.length === 0 }), references: [] };
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

export function sourceMatches(entry: BibEntry, query: string, locale: string): boolean {
  if (!query) return true;
  const summary = sourceSummary(entry);
  return [entry.key, summary.names, summary.year, summary.title].join(" ").toLocaleLowerCase(locale).includes(query);
}

export function sourceSummary(entry: BibEntry): { names: string; year: string; title: string } {
  const people = (entry.authors.some((name) => !name.others) ? entry.authors : entry.editors).filter((name) => !name.others);
  const family = people.map((name) => name.family);
  return {
    names: family.length > 2 ? `${family[0]} …` : family.join(", "),
    year: yearOf(entry),
    title: field(entry, "title") || field(entry, "journal", "journaltitle", "booktitle", "maintitle") || entry.key,
  };
}
