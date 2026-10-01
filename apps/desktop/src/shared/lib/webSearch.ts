export type WebSearchEngine = "google" | "bing" | "duckduckgo" | "startpage" | "brave" | "yandex" | "custom";

const MAX_QUERY_LENGTH = 500;
const MAX_TRANSLATE_ENCODED_LENGTH = 1800;
const TRANSLATE_TARGETS: Record<string, string> = { "zh-cn": "zh-CN", "zh-tw": "zh-TW", "pt-br": "pt" };
const WIKTIONARY_LOCALES = new Set(["en", "tr", "fr", "de", "es", "it", "pt", "ru", "ja", "zh", "nl", "pl"]);

function trimQuery(query: string): string {
  return query.trim().slice(0, MAX_QUERY_LENGTH);
}

function encode(query: string): string {
  return encodeURIComponent(trimQuery(query));
}

function baseLocale(uiLocale: string): string {
  return uiLocale.split("-")[0]?.toLowerCase() ?? "en";
}

const QUERY_PLACEHOLDER = /\{\{q\}\}|\{q\}/g;

function isWebAddress(template: string): boolean {
  try {
    const { protocol } = new URL(template.replace(QUERY_PLACEHOLDER, "q"));
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function customSearchUrl(template: string, encoded: string): string {
  const trimmed = template.trim();
  if (!isWebAddress(trimmed)) return `https://www.google.com/search?q=${encoded}`;
  if (trimmed.search(QUERY_PLACEHOLDER) >= 0) return trimmed.replace(QUERY_PLACEHOLDER, encoded);
  return `${trimmed}${encoded}`;
}

export function searchUrl(engine: WebSearchEngine, query: string, customUrl?: string): string {
  const encoded = encode(query);
  switch (engine) {
    case "google":
      return `https://www.google.com/search?q=${encoded}`;
    case "bing":
      return `https://www.bing.com/search?q=${encoded}`;
    case "duckduckgo":
      return `https://duckduckgo.com/?q=${encoded}`;
    case "startpage":
      return `https://www.startpage.com/sp/search?query=${encoded}`;
    case "brave":
      return `https://search.brave.com/search?q=${encoded}`;
    case "yandex":
      return `https://yandex.com/search/?text=${encoded}`;
    case "custom":
      return customSearchUrl(customUrl ?? "", encoded);
    default:
      return `https://www.google.com/search?q=${encoded}`;
  }
}

export function scholarUrl(query: string): string {
  return `https://scholar.google.com/scholar?q=${encode(query)}`;
}

export function wikipediaUrl(query: string, uiLocale: string): string {
  const locale = baseLocale(uiLocale);
  return `https://${locale}.wikipedia.org/w/index.php?search=${encode(query)}`;
}

function encodeWithin(query: string, maxEncodedLength: number): string {
  const characters = Array.from(query.trim());
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encodeURIComponent(characters.slice(0, middle).join("")).length <= maxEncodedLength) low = middle;
    else high = middle - 1;
  }
  const fitting = characters.slice(0, low).join("");
  const wordEnd = low < characters.length ? fitting.search(/\s\S*$/) : -1;
  return encodeURIComponent(wordEnd > 0 ? fitting.slice(0, wordEnd) : fitting);
}

function translateTarget(uiLocale: string): string {
  return TRANSLATE_TARGETS[uiLocale.toLowerCase()] ?? baseLocale(uiLocale);
}

export function translateUrl(query: string, uiLocale: string): string {
  return `https://translate.google.com/?sl=auto&tl=${translateTarget(uiLocale)}&text=${encodeWithin(query, MAX_TRANSLATE_ENCODED_LENGTH)}&op=translate`;
}

export function defineUrl(query: string, uiLocale: string): string {
  const locale = baseLocale(uiLocale);
  if (locale === "tr") return `https://sozluk.gov.tr/?ara=${encode(query)}`;
  const wiktionaryLocale = WIKTIONARY_LOCALES.has(locale) ? locale : "en";
  return `https://${wiktionaryLocale}.wiktionary.org/wiki/${encode(query)}`;
}
