const TOKENS = /\{[^{}]*\}|\s+|[^\s{]+|\{/g;
const SENTENCE_END = /[:?.!][”’"')\]]*$/;
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const TURKISH = /^(?:tr|tur|turkish|türkçe)\b/i;
const MIN_TITLE_WORD = 4;
const MIN_TITLE_WORDS = 2;
const TITLE_SHARE = 0.6;

export const SENTENCE_TITLE_TYPES = new Set(["article", "incollection", "inproceedings", "inbook", "conference", "preprint"]);

export function titleLocale(entryLanguage: string | undefined, documentLanguage: string): string {
  if (entryLanguage?.trim()) return TURKISH.test(entryLanguage.trim()) ? "tr" : "en";
  return documentLanguage.toLowerCase().startsWith("tr") ? "tr" : "en";
}

function coreOf(segment: string): string {
  return segment.replace(EDGE, "");
}

function kept(segment: string, locale: string): boolean {
  const core = coreOf(segment);
  if (!core) return true;
  if (/\p{N}/u.test(core)) return true;
  if (/\p{Lu}/u.test(Array.from(core).slice(1).join("")) && core !== core.toLocaleUpperCase(locale)) return true;
  const letters = Array.from(core).filter((char) => /\p{L}/u.test(char));
  if (letters.length >= 2 && core === core.toLocaleUpperCase(locale)) return true;
  return letters.length === 1 && core !== "A" && core === core.toLocaleUpperCase(locale);
}

function lowered(word: string, locale: string, first: boolean): string {
  return word
    .split(/(-)/)
    .map((segment, index) => (segment === "-" || (first && index === 0) || kept(segment, locale) ? segment : segment.toLocaleLowerCase(locale)))
    .join("");
}

function words(title: string): { token: string; start: boolean; protectedCase: boolean }[] {
  const found: { token: string; start: boolean; protectedCase: boolean }[] = [];
  let start = true;
  for (const token of title.match(TOKENS) ?? []) {
    if (/^\s+$/.test(token)) {
      found.push({ token, start: false, protectedCase: true });
      continue;
    }
    found.push({ token, start, protectedCase: token.startsWith("{") });
    start = SENTENCE_END.test(token);
  }
  return found;
}

export function sentenceCase(title: string, locale: string): string {
  return words(title)
    .map(({ token, start, protectedCase }) => (protectedCase ? token : lowered(token, locale, start)))
    .join("");
}

export function looksTitleCase(title: string, locale: string): boolean {
  let eligible = 0;
  let capitalised = 0;
  for (const { token, start, protectedCase } of words(title)) {
    if (start || protectedCase) continue;
    const core = coreOf(token);
    if (Array.from(core).length < MIN_TITLE_WORD || !/^\p{L}+$/u.test(core)) continue;
    eligible += 1;
    if (!kept(core, locale) && core !== core.toLocaleLowerCase(locale)) capitalised += 1;
  }
  return capitalised >= MIN_TITLE_WORDS && capitalised / eligible >= TITLE_SHARE;
}
