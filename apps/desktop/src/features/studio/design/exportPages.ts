import { rangePages } from "@/shared/lib/pageScope";
import { stemOf } from "@/shared/lib/paths";
import type { StudioExportFormat } from "@/types/studio";

export const PAGE_CHOICES = ["all", "current", "custom"] as const;

export type PageChoice = (typeof PAGE_CHOICES)[number];

export type PageRangeError = "empty" | "invalid" | "outOfRange";

export type PageSelection = { ok: true; pages: number[] } | { ok: false; error: PageRangeError };

const RANGE_TOKEN = /^\s*\d*\s*-?\s*\d*\s*$/;
const MAX_RANGE_LENGTH = 400;

export function parsePageRange(text: string, pageCount: number): PageSelection {
  const spec = text.trim();
  if (!spec) return { ok: false, error: "empty" };
  if (spec.length > MAX_RANGE_LENGTH) return { ok: false, error: "invalid" };
  const tokens = spec.split(",");
  if (tokens.some((token) => !token.trim() || token.trim() === "-" || !RANGE_TOKEN.test(token))) return { ok: false, error: "invalid" };
  const pages = rangePages(spec, pageCount);
  return pages ? { ok: true, pages } : { ok: false, error: "outOfRange" };
}

export function selectPages(choice: PageChoice, custom: string, currentIndex: number, pageCount: number): PageSelection {
  if (choice === "current") return { ok: true, pages: [Math.min(pageCount, Math.max(1, currentIndex + 1))] };
  if (choice === "custom") return parsePageRange(custom, pageCount);
  return { ok: true, pages: Array.from({ length: pageCount }, (_, index) => index + 1) };
}

export function isEveryPage(pages: number[], pageCount: number): boolean {
  return pages.length === pageCount && pages.every((page, index) => page === index + 1);
}

export function pictureNames(output: string, format: StudioExportFormat, pages: number[], copies: number): string[] {
  const stem = stemOf(output) || "design";
  const total = pages.length * Math.max(1, copies);
  if (total === 1) return [`${stem}.${format}`];
  const labels = copies > 1 ? Array.from({ length: total }, (_, index) => index + 1) : pages;
  return labels.map((label) => `${stem}-${label}.${format}`);
}
