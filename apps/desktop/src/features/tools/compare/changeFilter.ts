import type { PageDiff } from "@/types";

export type ChangeFilter = "all" | "text" | "visual" | "pages";

export const CHANGE_FILTERS: ChangeFilter[] = ["all", "text", "visual", "pages"];

const VISUAL_THRESHOLD = 0.002;

export function hasTextChange(page: PageDiff): boolean {
  return page.addedWords > 0 || page.removedWords > 0;
}

export function hasVisualChange(page: PageDiff): boolean {
  return page.changedArea > VISUAL_THRESHOLD || page.sizeChanged;
}

export function isUnpaired(page: PageDiff): boolean {
  return !(page.inA && page.inB);
}

export function isChanged(page: PageDiff): boolean {
  return hasTextChange(page) || hasVisualChange(page) || isUnpaired(page);
}

export function matchesFilter(page: PageDiff, filter: ChangeFilter): boolean {
  if (filter === "text") return hasTextChange(page);
  if (filter === "visual") return hasVisualChange(page);
  if (filter === "pages") return isUnpaired(page);
  return isChanged(page);
}

export function pageLabel(pageA: number | null | undefined, pageB: number | null | undefined): string {
  if (pageA && pageB) return pageA === pageB ? `p${pageA}` : `A${pageA} · B${pageB}`;
  if (pageA) return `A${pageA}`;
  return `B${pageB ?? "?"}`;
}

export function areaPercent(area: number): string {
  return area < 0.01 ? "<1%" : `${Math.round(area * 100)}%`;
}

export function filterCounts(pages: PageDiff[]): Record<ChangeFilter, number> {
  return {
    all: pages.filter(isChanged).length,
    text: pages.filter(hasTextChange).length,
    visual: pages.filter(hasVisualChange).length,
    pages: pages.filter(isUnpaired).length,
  };
}
