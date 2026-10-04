import type { StudioDesign, StudioElement, StudioTextElement } from "@/types/studio";
import { replaceRange } from "./richText";
import { textOf } from "../model/design";
import { lowerChar } from "../model/typography";

export type FindOptions = { matchCase: boolean; wholeWord: boolean; language: string };
export type TextRange = { start: number; end: number };
export type TextMatch = TextRange & { pageId: string; elementId: string };

const WORD = /[\p{L}\p{N}\p{M}_]/u;

function fold(text: string, options: FindOptions): string {
  if (options.matchCase) return text;
  let folded = "";
  for (let index = 0; index < text.length; index += 1) {
    const lower = lowerChar(text[index], options.language);
    folded += lower.length === 1 ? lower : lower[0];
  }
  return folded;
}

function isWord(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char);
}

export function findInText(text: string, query: string, options: FindOptions): TextRange[] {
  if (!query) return [];
  const haystack = fold(text, options);
  const needle = fold(query, options);
  const found: TextRange[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) break;
    const end = start + needle.length;
    const bounded = !options.wholeWord || (!(isWord(text[start]) && isWord(text[start - 1])) && !(isWord(text[end - 1]) && isWord(text[end])));
    if (bounded) {
      found.push({ start, end });
      from = end;
    } else {
      from = start + 1;
    }
  }
  return found;
}

function searchable(element: StudioElement): element is StudioTextElement {
  return element.kind === "text" && !element.hidden && !element.locked;
}

export function findMatches(design: StudioDesign, query: string, options: FindOptions): TextMatch[] {
  const matches: TextMatch[] = [];
  for (const page of design.pages) {
    for (const element of page.elements) {
      if (!searchable(element)) continue;
      for (const range of findInText(textOf(element.runs), query, { ...options, language: element.language ?? options.language })) {
        matches.push({ ...range, pageId: page.id, elementId: element.id });
      }
    }
  }
  return matches;
}

export function replaceMatches(design: StudioDesign, matches: TextMatch[], replacement: string): StudioDesign {
  if (!matches.length) return design;
  const text = replacement.replace(/\r?\n|\r/g, " ");
  const byElement = new Map<string, TextMatch[]>();
  for (const match of matches) byElement.set(match.elementId, [...(byElement.get(match.elementId) ?? []), match]);
  return {
    ...design,
    pages: design.pages.map((page) => {
      if (!page.elements.some((element) => byElement.has(element.id))) return page;
      return {
        ...page,
        elements: page.elements.map((element) => {
          const found = byElement.get(element.id);
          if (!found || !searchable(element)) return element;
          let next = element;
          for (const match of [...found].sort((left, right) => right.start - left.start)) next = { ...next, runs: replaceRange(next, match.start, match.end, text) };
          return next;
        }),
      };
    }),
  };
}
