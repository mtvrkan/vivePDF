import type { PageScope, PageScopeKind } from "@/types";

export const PAGE_SCOPE_KINDS: PageScopeKind[] = ["all", "odd", "even", "every", "ranges"];

const RANGE_TOKEN = /^\s*(\d*)\s*(-)?\s*(\d*)\s*$/;

export function rangePages(spec: string, pageCount: number): number[] | null {
  if (!spec.trim()) return null;
  const pages: number[] = [];
  const seen = new Set<number>();
  for (const token of spec.split(",")) {
    const match = RANGE_TOKEN.exec(token);
    if (!match || !token.trim()) return null;
    const [, first, dash, last] = match;
    if (!first && !last) return null;
    const start = first ? Number(first) : 1;
    const end = last ? Number(last) : dash ? pageCount : start;
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) return null;
    const step = end >= start ? 1 : -1;
    for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
      if (seen.has(page)) continue;
      seen.add(page);
      pages.push(page);
    }
  }
  return pages;
}

export function scopePages(scope: PageScope, pageCount: number): number[] | null {
  if (pageCount <= 0) return [];
  const every = (from: number, step: number) => {
    const pages: number[] = [];
    for (let page = from; page <= pageCount; page += step) pages.push(page);
    return pages;
  };
  switch (scope.kind) {
    case "odd":
      return every(1, 2);
    case "even":
      return every(2, 2);
    case "every": {
      const step = Math.floor(scope.every ?? 2);
      const start = Math.floor(scope.start ?? 1);
      if (!Number.isFinite(step) || !Number.isFinite(start) || step < 1 || start < 1) return null;
      return every(start, step);
    }
    case "ranges":
      return rangePages(scope.ranges ?? "", pageCount);
    default:
      return every(1, 1);
  }
}

export function pagesToRanges(pages: number[]): string {
  const parts: string[] = [];
  let index = 0;
  while (index < pages.length) {
    let end = index;
    while (end + 1 < pages.length && pages[end + 1] === pages[end] + 1) end += 1;
    parts.push(end === index ? `${pages[index]}` : `${pages[index]}-${pages[end]}`);
    index = end + 1;
  }
  return parts.join(", ");
}
