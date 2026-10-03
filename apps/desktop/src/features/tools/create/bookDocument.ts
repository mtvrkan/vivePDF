import { basenameOf, dirnameOf, extensionOf, pathKey } from "@/shared/lib/paths";
import type { BookPaper } from "@/types";
import { TEXT_SOURCE_EXTENSIONS } from "./createDocument";

export const BOOK_PAPERS: readonly BookPaper[] = ["a5", "b5", "a4", "letter"];
export const MAX_BOOK_CHAPTERS = 200;
export const BOOK_TOC_DEPTHS = ["chapters", "sections"] as const;
export type BookTocDepth = (typeof BOOK_TOC_DEPTHS)[number];

export function isChapterFile(path: string): boolean {
  return TEXT_SOURCE_EXTENSIONS.includes(extensionOf(path).toLowerCase());
}

export function withChapters(current: string[], added: string[]): string[] {
  const seen = new Set(current.map(pathKey));
  const next = [...current];
  for (const path of added) {
    if (next.length >= MAX_BOOK_CHAPTERS) break;
    const key = pathKey(path);
    if (seen.has(key) || !isChapterFile(path)) continue;
    seen.add(key);
    next.push(path);
  }
  return next;
}

export function movedChapter(chapters: string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= chapters.length || target < 0 || target >= chapters.length) return chapters;
  const next = [...chapters];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function chaptersByName(chapters: string[], locale: string): string[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return [...chapters].sort((left, right) => collator.compare(basenameOf(left), basenameOf(right)));
}

export function suggestedBookTitle(chapters: string[]): string {
  if (chapters.length === 0) return "";
  const folder = basenameOf(dirnameOf(chapters[0]));
  return folder.replace(/[_-]+/g, " ").trim();
}
