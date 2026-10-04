import type { StudioListKind, StudioParagraph, StudioTextCase, StudioTextRun } from "@/types/studio";

export const DEFAULT_TEXT_FONT_ID = "bundled:dejavu-sans";
export const LIST_INDENT_EM = 1.6;
export const MAX_LIST_LEVEL = 8;
export const REGULAR_WEIGHT = 400;
export const BOLD_WEIGHT = 700;
export const BOLD_FROM = 600;
export const DEFAULT_PARAGRAPH: StudioParagraph = { list: "none", level: 0 };
export const NUMBERED_LISTS: ReadonlySet<StudioListKind> = new Set(["decimal", "alpha", "roman"]);
export const CHECK_MARK = "✓";

const DOTLESS = new Set(["tr", "az"]);
const BULLETS: Partial<Record<StudioListKind, string>> = { bullet: "•", dash: "–", check: CHECK_MARK };
const WORD_INSIDE = /[\p{L}\p{N}\p{M}'’ʼ]/u;
const LETTER = /\p{L}/u;
const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

export function weightOf(bold: boolean, weight: number | null | undefined): number {
  return weight ?? (bold ? BOLD_WEIGHT : REGULAR_WEIGHT);
}

function dotless(language: string): boolean {
  return DOTLESS.has(language.split("-")[0].toLowerCase());
}

export function upperChar(char: string, language: string): string {
  if (char === "i" && dotless(language)) return "İ";
  return char.toUpperCase();
}

export function lowerChar(char: string, language: string): string {
  if (dotless(language)) {
    if (char === "I") return "ı";
    if (char === "İ") return "i";
  }
  return char.toLowerCase();
}

export function caseTexts(texts: string[], mode: StudioTextCase, language: string): string[] {
  if (mode === "none") return texts;
  let previous = "";
  return texts.map((text) => {
    let result = "";
    for (const char of text) {
      if (mode === "upper") result += upperChar(char, language);
      else if (mode === "lower") result += lowerChar(char, language);
      else result += LETTER.test(char) && !WORD_INSIDE.test(previous) ? upperChar(char, language) : char;
      previous = char;
    }
    return result;
  });
}

export function caseText(text: string, mode: StudioTextCase, language: string): string {
  return caseTexts([text], mode, language)[0];
}

function alphaLabel(count: number): string {
  let value = count;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(97 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function romanLabel(count: number): string {
  let value = count;
  let label = "";
  for (const [amount, symbol] of ROMAN) {
    while (value >= amount) {
      label += symbol;
      value -= amount;
    }
  }
  return label;
}

export function markerText(kind: StudioListKind, count: number): string | null {
  if (kind === "none") return null;
  const bullet = BULLETS[kind];
  if (bullet) return bullet;
  if (kind === "decimal") return `${count}.`;
  if (kind === "alpha") return `${alphaLabel(count)})`;
  return `${romanLabel(count)}.`;
}

export function listMarkers(paragraphs: StudioParagraph[]): (string | null)[] {
  const counters: { kind: StudioListKind; count: number }[] = [];
  return paragraphs.map((paragraph) => {
    if (paragraph.list === "none") {
      counters.length = 0;
      return null;
    }
    const level = paragraph.level;
    counters.length = Math.min(counters.length, level + 1);
    const current = counters[level];
    const count = current && current.kind === paragraph.list ? current.count + 1 : 1;
    counters[level] = { kind: paragraph.list, count };
    for (let index = 0; index < level; index += 1) counters[index] ??= { kind: "none", count: 0 };
    return markerText(paragraph.list, count);
  });
}

export function paragraphCount(runs: StudioTextRun[]): number {
  let count = 1;
  for (const run of runs) for (const char of run.text) if (char === "\n") count += 1;
  return count;
}

export function paragraphAt(paragraphs: StudioParagraph[], index: number): StudioParagraph {
  return paragraphs[index] ?? DEFAULT_PARAGRAPH;
}

export function fitParagraphs(paragraphs: StudioParagraph[], count: number): StudioParagraph[] {
  if (paragraphs.length === count) return paragraphs;
  return Array.from({ length: count }, (_, index) => paragraphAt(paragraphs, index));
}

export type TextParagraph = { paragraph: StudioParagraph; runs: StudioTextRun[]; marker: string | null; text: string };

export function splitParagraphs(runs: StudioTextRun[], paragraphs: StudioParagraph[], fill?: (text: string) => string): TextParagraph[] {
  const split: { paragraph: StudioParagraph; runs: StudioTextRun[] }[] = [{ paragraph: paragraphAt(paragraphs, 0), runs: [] }];
  for (const run of runs) {
    run.text.split("\n").forEach((part, index) => {
      if (index) split.push({ paragraph: paragraphAt(paragraphs, split.length), runs: [] });
      if (part) split[split.length - 1].runs.push({ ...run, text: part });
    });
  }
  const filled = fill
    ? split.flatMap((entry) => {
        const pieces: { paragraph: StudioParagraph; runs: StudioTextRun[] }[] = [{ paragraph: entry.paragraph, runs: [] }];
        for (const run of entry.runs) {
          fill(run.text)
            .replace(/\r\n?/g, "\n")
            .split("\n")
            .forEach((part, index) => {
              if (index) pieces.push({ paragraph: entry.paragraph, runs: [] });
              if (part) pieces[pieces.length - 1].runs.push({ ...run, text: part });
            });
        }
        return pieces;
      })
    : split;
  const markers = listMarkers(filled.map((entry) => entry.paragraph));
  return filled.map((entry, index) => ({ ...entry, marker: markers[index], text: entry.runs.map((run) => run.text).join("") }));
}

export function visibleParagraphs(list: TextParagraph[]): TextParagraph[] {
  const last = list[list.length - 1];
  return list.length > 1 && last.text === "" ? list.slice(0, -1) : list;
}
