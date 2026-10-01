const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "\u00a0": " ",
  "’": "'",
  "“": '"',
  "”": '"',
};
const SPECIAL_CHARACTERS = /[ﬀ-ﬄ\u00a0’“”]/g;
const LINE_NUMBER = /^\s*(\d{1,4})(?:[.:)]\s?|\s)/;
const NUMBER_ONLY = /^\s*\d{1,4}\s*$/;
const MIN_NUMBERED_RATIO = 0.6;
const SOFT_HYPHEN = /\u00ad/g;
const SOFT_HYPHEN_INSIDE_WORD = /(?<=\p{L})\u00ad(?=\p{L})/gu;
const BROKEN_WORD_END = /(\p{L})[-\u2010\u00ad]$/u;
const LOWERCASE_START = /^\p{Ll}/u;
const LIST_ITEM_START = /^\s*(?:[-*•▪◦–]\s|\(?\d{1,3}[.)]\s|\(?[a-z][.)]\s|\[\d{1,3}\]\s)/u;

function normalizeCharacters(text: string): string {
  return text.replace(SPECIAL_CHARACTERS, (char) => LIGATURES[char] ?? char);
}

function stripLineNumbers(lines: string[]): string[] {
  const content = lines.filter((line) => line.trim() !== "");
  if (content.length < 2) return lines;
  let numbered = 0;
  let previous = 0;
  let ascending = 0;
  for (const line of content) {
    const match = LINE_NUMBER.exec(line) ?? (NUMBER_ONLY.test(line) ? [line, line.trim()] : null);
    if (!match) continue;
    numbered += 1;
    const value = Number(match[1]);
    if (value > previous) ascending += 1;
    previous = value;
  }
  if (numbered / content.length < MIN_NUMBERED_RATIO || ascending < numbered * MIN_NUMBERED_RATIO) return lines;
  return lines.filter((line) => !NUMBER_ONLY.test(line)).map((line) => line.replace(LINE_NUMBER, ""));
}

function mergeNumberColumn(lines: string[]): string[] {
  const numeric = lines.filter((line) => NUMBER_ONLY.test(line)).length;
  const textual = lines.filter((line) => line.trim() !== "" && !NUMBER_ONLY.test(line)).length;
  if (numeric === 0 || textual === 0 || numeric < textual * MIN_NUMBERED_RATIO) return lines;
  return lines.filter((line) => !NUMBER_ONLY.test(line));
}

function joinBrokenWords(lines: string[]): string[] {
  const joined: string[] = [];
  for (const line of lines) {
    const previous = joined[joined.length - 1];
    const next = line.trimStart();
    if (previous !== undefined && BROKEN_WORD_END.test(previous) && LOWERCASE_START.test(next)) {
      const cut = next.search(/\s/);
      const word = cut < 0 ? next : next.slice(0, cut);
      const remainder = cut < 0 ? "" : next.slice(cut).trimStart();
      joined[joined.length - 1] = previous.slice(0, -1) + word;
      if (remainder) joined.push(remainder);
      continue;
    }
    joined.push(line);
  }
  return joined;
}

export function cleanCopiedText(pages: string[]): string {
  const lines = pages.flatMap((page) => page.split(/\r\n|\r|\n/));
  const normalized = lines.map((line) => normalizeCharacters(line).replace(SOFT_HYPHEN_INSIDE_WORD, "").replace(/[ \t]+$/g, ""));
  const cleaned = joinBrokenWords(stripLineNumbers(mergeNumberColumn(normalized))).map((line) => line.replace(SOFT_HYPHEN, "-"));
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function reflowParagraphs(text: string): string {
  const paragraphs: string[] = [];
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (current) paragraphs.push(current);
      current = "";
      continue;
    }
    if (current && LIST_ITEM_START.test(line)) {
      paragraphs.push(current);
      current = line;
      continue;
    }
    current = current ? `${current} ${line}` : line;
  }
  if (current) paragraphs.push(current);
  return paragraphs.map((paragraph) => paragraph.replace(/\s{2,}/g, " ")).join("\n\n");
}
