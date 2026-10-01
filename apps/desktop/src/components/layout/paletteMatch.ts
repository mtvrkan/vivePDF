export type PaletteMode = "actions" | "pages" | "documents" | "page" | null;

const TURKISH_DOTLESS_I = /ı/g;
const TURKISH_DOTTED_I = /İ/g;
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeText(value: string, locale: string): string {
  return value
    .toLocaleLowerCase(locale)
    .replace(TURKISH_DOTLESS_I, "i")
    .replace(TURKISH_DOTTED_I, "i")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(query: string, locale: string): string[] {
  return normalizeText(query, locale).split(" ").filter(Boolean);
}

function wordStartMatch(haystack: string, token: string): boolean {
  return haystack.split(" ").some((word) => word.startsWith(token));
}

function scoreToken(token: string, title: string, subtitle: string, keywords: string): number {
  if (title.startsWith(token)) return 100;
  if (wordStartMatch(title, token)) return 60;
  if (title.includes(token)) return 30;
  if (keywords.includes(token)) return 20;
  if (subtitle.includes(token)) return 10;
  return 0;
}

export type MatchTarget = {
  title: string;
  subtitle?: string;
  keywords?: string;
};

export function scoreEntry(query: string, target: MatchTarget, locale: string): number {
  const tokens = tokenize(query, locale);
  if (tokens.length === 0) return 0;
  const title = normalizeText(target.title, locale);
  const subtitle = target.subtitle ? normalizeText(target.subtitle, locale) : "";
  const keywords = target.keywords ? normalizeText(target.keywords, locale) : "";
  let total = 0;
  for (const token of tokens) {
    const tokenScore = scoreToken(token, title, subtitle, keywords);
    if (tokenScore === 0) return 0;
    total += tokenScore;
  }
  const fullQuery = normalizeText(query, locale);
  if (title === fullQuery) total += 40;
  else if (title.startsWith(fullQuery)) total += 20;
  return total;
}

export function detectPaletteMode(query: string): { mode: PaletteMode; rest: string } {
  const prefix = query.charAt(0);
  if (prefix === ">") return { mode: "actions", rest: query.slice(1).trimStart() };
  if (prefix === "/") return { mode: "pages", rest: query.slice(1).trimStart() };
  if (prefix === "@") return { mode: "documents", rest: query.slice(1).trimStart() };
  if (prefix === "#") return { mode: "page", rest: query.slice(1).trimStart() };
  return { mode: null, rest: query };
}

const PAGE_QUERY_PATTERN = /^(?:[ps#]\s*)?(\d+)$/i;

export function parsePageQuery(query: string): number | null {
  const match = PAGE_QUERY_PATTERN.exec(query.trim());
  if (!match) return null;
  const page = Number(match[1]);
  return page > 0 ? page : null;
}

export function highlightRanges(title: string, query: string, locale: string): Array<{ text: string; matched: boolean }> {
  const needle = normalizeText(query, locale);
  if (!needle) return [{ text: title, matched: false }];
  const haystack = title.toLocaleLowerCase(locale);
  const index = haystack.indexOf(needle);
  if (index === -1) return [{ text: title, matched: false }];
  const ranges: Array<{ text: string; matched: boolean }> = [];
  if (index > 0) ranges.push({ text: title.slice(0, index), matched: false });
  ranges.push({ text: title.slice(index, index + needle.length), matched: true });
  if (index + needle.length < title.length) ranges.push({ text: title.slice(index + needle.length), matched: false });
  return ranges;
}
