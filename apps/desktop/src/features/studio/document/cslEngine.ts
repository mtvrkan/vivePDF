import CSL, { type CiteprocCitation, type CiteprocItem, type Engine } from "citeproc";
import * as logger from "@/shared/lib/logger";
import type { BibEntry, CitationLanguage, CitationStyle, DocumentNode } from "@/types/studio";
import type { CitationItem } from "./citationItems";
import { citationClusters, isNoteStyle, type CitationCluster, type CitationLabel, type Citations } from "./citations";
import { shownItemOf } from "./cslJson";
import { escapeHtml } from "./toHtml";

const STYLE_FILES: Record<CitationStyle, string> = {
  apa: "apa",
  mla: "modern-language-association",
  chicago: "chicago-author-date",
  "chicago-notes": "chicago-notes-bibliography",
  ieee: "ieee",
  isnad: "isnad-metinici",
  "isnad-notes": "isnad-dipnotlu",
  vancouver: "nlm-citation-sequence",
  harvard: "harvard-cite-them-right",
};
const FALLBACK_LOCALE = "en-US";
const EAGER_STYLES = import.meta.glob<string>("./csl/styles/apa.csl", { query: "?raw", import: "default", eager: true });
const EAGER_LOCALES = import.meta.glob<string>("./csl/locales/locales-en-US.xml", { query: "?raw", import: "default", eager: true });
const STYLES = import.meta.glob<string>(["./csl/styles/*.csl", "!./csl/styles/apa.csl"], { query: "?raw", import: "default" });
const LOCALES = import.meta.glob<string>(["./csl/locales/*.xml", "!./csl/locales/locales-en-US.xml"], { query: "?raw", import: "default" });
const DEFAULT_LOCALE = /<style\b[^>]*\bdefault-locale="([^"]+)"/;
const SAFE_TAG = /^<\/?(?:i|b|sup|sub)>$|^<span style="font-(?:variant:\s?small-caps|style:\s?normal|weight:\s?normal);?">$|^<\/span>$/;
const WEB_ADDRESS = /(https?:\/\/[^\s<"]+?)([.,;:)]*)(?=\s|<|$)/g;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const CITEPROC_TAG = /<(?=\/?(?:i|b|sc|sup|sub|span)\b)/gi;
const TAG_BREAK = "\u2060";
const TURKISH_TERMS = /(?<!\p{L})I(?=(?:çinde|nceleme(?:si)?|fadesi|kinci|lk sayfa|cra eden(?:ler)?)(?!\p{L}))/gu;

const engines = new Map<string, Promise<CitationEngine>>();
const ready = new Map<string, CitationEngine>();
const fetchedFiles = new Map<string, string>();

function localeFile(language: string): string {
  return `./csl/locales/locales-${language}.xml`;
}

export function safeCitationHtml(html: string): string {
  return html.replace(/<[^>]*>/g, (tag) => (SAFE_TAG.test(tag) ? tag : "")).replaceAll(TAG_BREAK, "");
}

function literal<T>(value: T): T {
  if (typeof value === "string") return value.replace(CITEPROC_TAG, `<${TAG_BREAK}`) as T;
  if (Array.isArray(value)) return value.map(literal) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, literal(inner)])) as T;
  return value;
}

export function plainCitationText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal: string, hex: string, name: string) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return ENTITIES[name.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function referenceHtml(entry: string): string {
  const inner = entry
    .trim()
    .replace(/^<div class="csl-entry">/, "")
    .replace(/<\/div>$/, "")
    .trim()
    .replace(/<div class="csl-left-margin">([\s\S]*?)<\/div>\s*<div class="csl-right-inline">([\s\S]*?)<\/div>/, "$1&nbsp;$2");
  return safeCitationHtml(inner)
    .replace(/\s+/g, " ")
    .trim()
    .replace(WEB_ADDRESS, '<a href="$1">$1</a>$2');
}

function dottedCapitals(html: string): string {
  return html.replace(TURKISH_TERMS, "İ");
}

function unchanged(html: string): string {
  return html;
}

function citeItem(item: CitationItem): CiteprocItem {
  const id = item.key.toLowerCase();
  const locator = item.locator.trim();
  if (!locator) return { id };
  return /^\d/.test(locator) ? { id, locator, label: "page" } : { id, suffix: `, ${locator}` };
}

function sameItems(a: CitationItem[], b: CitationItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item.key.toLowerCase() === b[index].key.toLowerCase() && item.locator === b[index].locator);
}

function signatureOf(items: CitationItem[]): string {
  return JSON.stringify(items.map((item) => [item.key.toLowerCase(), item.locator]));
}

type Build = { content: DocumentNode | string; sources: BibEntry[]; signature: string; value: Citations };

export class CitationEngine {
  readonly style: CitationStyle;
  private readonly engine: Engine;
  private items = new Map<string, Record<string, unknown>>();
  private last: Build | null = null;
  private builds = 0;
  private readonly language: CitationLanguage;
  private readonly cased: (html: string) => string;

  constructor(style: CitationStyle, engine: Engine, items: Map<string, Record<string, unknown>>, language: CitationLanguage = "en-US") {
    this.style = style;
    this.engine = engine;
    this.items = items;
    this.language = language;
    this.cased = language === "tr-TR" ? dottedCapitals : unchanged;
  }

  citations(content: DocumentNode | string, sources: BibEntry[]): Citations {
    const last = this.last;
    if (last && last.content === content && last.sources === sources) return last.value;
    const notes = isNoteStyle(this.style);
    const clusters = citationClusters(content, notes);
    const signature = JSON.stringify(clusters);
    if (last && last.sources === sources && last.signature === signature) {
      this.last = { ...last, content };
      return last.value;
    }
    const value = this.build(clusters, sources, notes);
    this.last = { content, sources, signature, value };
    return value;
  }

  private build(clusters: CitationCluster[], sources: BibEntry[], notes: boolean): Citations {
    try {
      this.engine.updateItems([]);
      this.engine.updateUncitedItems([]);
    } catch (caught) {
      logger.error("citations", logger.describeError(caught));
    }
    this.items.clear();
    for (const entry of sources) {
      const id = entry.key.toLowerCase();
      if (!this.items.has(id)) this.items.set(id, { ...literal(shownItemOf(entry, this.language)), id });
    }
    const known = (items: CitationItem[]) => items.filter((item) => this.items.has(item.key.toLowerCase()));
    const build = `b${(this.builds += 1)}`;
    const citations: CiteprocCitation[] = [];
    clusters.forEach((cluster, index) => {
      const items = known(cluster.items);
      if (items.length > 0) citations.push({ citationID: `${build}-${index}`, citationItems: items.map(citeItem), properties: { noteIndex: cluster.noteIndex } });
    });
    const before: [string, number][] = citations.map((citation) => [citation.citationID ?? "", citation.properties.noteIndex]);
    const rendered = new Map<number, string>();
    let references: string[] = [];
    try {
      for (const [id, , html] of this.engine.rebuildProcessorState(citations, "html", citations.length > 0 ? [] : [...this.items.keys()])) rendered.set(Number(id.slice(build.length + 1)), this.cased(safeCitationHtml(html)));
      const bibliography = this.engine.makeBibliography();
      references = bibliography ? bibliography[1].map((entry) => this.cased(referenceHtml(entry))) : [];
    } catch (caught) {
      logger.error("citations", logger.describeError(caught));
    }
    const previews = new Map<string, string>();
    const preview = (items: CitationItem[], inNote: boolean) => {
      const key = `${inNote ? "n" : "b"}${signatureOf(items)}`;
      let html = previews.get(key);
      if (html === undefined) {
        try {
          html = this.cased(safeCitationHtml(this.engine.previewCitationCluster({ citationItems: items.map(citeItem), properties: { noteIndex: notes ? clusters.length + 1 : 0 } }, before, [], "html")));
        } catch (caught) {
          logger.error("citations", logger.describeError(caught));
          html = "";
        }
        previews.set(key, html);
      }
      return html;
    };
    const lookup = (items: CitationItem[], ordinal: number | undefined, inNote: boolean): string | undefined => {
      if (ordinal !== undefined && clusters[ordinal] && sameItems(clusters[ordinal].items, items)) return rendered.get(ordinal);
      const index = clusters.findIndex((cluster) => cluster.inNote === inNote && sameItems(cluster.items, items));
      return index >= 0 ? rendered.get(index) : undefined;
    };
    const numeric = !notes && /^\[/.test(rendered.values().next().value ?? references[0] ?? "");
    const label = (items: CitationItem[], ordinal?: number, inNote = false): CitationLabel => {
      const cited = known(items);
      const missing = items.filter((item) => !this.items.has(item.key.toLowerCase())).map((item) => `${item.key}?`);
      const html = cited.length > 0 ? (lookup(items, ordinal, inNote) ?? preview(cited, inNote)) : "";
      if (cited.length === 0) {
        const text = numeric ? "[?]" : `(${missing.join("; ") || "?"})`;
        return { text, html: escapeHtml(text), missing: true };
      }
      if (!html) return { text: "?", html: "?", missing: true };
      if (missing.length === 0) return { text: plainCitationText(html), html, missing: false };
      const tail = ` (${missing.join("; ")})`;
      return { text: `${plainCitationText(html)}${tail}`, html: `${html}${escapeHtml(tail)}`, missing: true };
    };
    return { style: this.style, notes, ready: true, label, references };
  }
}

function engineKey(style: CitationStyle, language: CitationLanguage): string {
  return `${style}|${language}`;
}

function styleFile(style: CitationStyle): string {
  return `./csl/styles/${STYLE_FILES[style]}.csl`;
}

function stored(path: string): string | undefined {
  return EAGER_STYLES[path] ?? EAGER_LOCALES[path] ?? fetchedFiles.get(path);
}

function localesWanted(xml: string, language: CitationLanguage): string[] {
  return [...new Set([language, FALLBACK_LOCALE, DEFAULT_LOCALE.exec(xml)?.[1] ?? FALLBACK_LOCALE])].filter((name) => LOCALES[localeFile(name)] !== undefined || EAGER_LOCALES[localeFile(name)] !== undefined);
}

function engineNow(style: CitationStyle, language: CitationLanguage): CitationEngine | null {
  const key = engineKey(style, language);
  const known = ready.get(key);
  if (known) return known;
  const xml = stored(styleFile(style));
  if (xml === undefined) return null;
  const wanted = localesWanted(xml, language);
  if (wanted.some((name) => stored(localeFile(name)) === undefined)) return null;
  const locales = new Map(wanted.map((name) => [name, stored(localeFile(name)) ?? ""]));
  const items = new Map<string, Record<string, unknown>>();
  const sys = {
    retrieveLocale: (name: string) => locales.get(name) ?? locales.get(name.split("-")[0]) ?? locales.get(FALLBACK_LOCALE),
    retrieveItem: (id: string) => items.get(id),
  };
  const engine = new CitationEngine(style, new CSL.Engine(sys, xml, language, true), items, language);
  ready.set(key, engine);
  return engine;
}

async function fetchFile(path: string, files: Record<string, () => Promise<string>>): Promise<void> {
  const load = files[path];
  if (stored(path) !== undefined || !load) return;
  fetchedFiles.set(path, await load());
}

async function createEngine(style: CitationStyle, language: CitationLanguage): Promise<CitationEngine> {
  await fetchFile(styleFile(style), STYLES);
  const xml = stored(styleFile(style)) ?? "";
  await Promise.all(localesWanted(xml, language).map((name) => fetchFile(localeFile(name), LOCALES)));
  const engine = engineNow(style, language);
  if (!engine) throw new Error(`citation style ${style} (${language}) is not bundled`);
  return engine;
}

export function loadCitationEngine(style: CitationStyle, language: CitationLanguage): Promise<CitationEngine> {
  const now = engineNow(style, language);
  if (now) return Promise.resolve(now);
  const key = engineKey(style, language);
  let pending = engines.get(key);
  if (!pending) {
    pending = createEngine(style, language);
    pending.catch(() => engines.delete(key));
    engines.set(key, pending);
  }
  return pending;
}

export function readyCitationEngine(style: CitationStyle, language: CitationLanguage): CitationEngine | null {
  return engineNow(style, language);
}

export async function buildCitations(content: DocumentNode | string, sources: BibEntry[], style: CitationStyle, language: CitationLanguage): Promise<Citations> {
  return (await loadCitationEngine(style, language)).citations(content, sources);
}
