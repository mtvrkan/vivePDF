export function mergedPageTotal(counts: number[], interleave: boolean, padOdd: boolean): number {
  const pages = counts.reduce((sum, count) => sum + count, 0);
  if (interleave || !padOdd) return pages;
  return pages + counts.slice(0, -1).filter((count) => count % 2 === 1).length;
}

export function sortedByName<T extends { path: string }>(items: T[], locale: string, nameOf: (path: string) => string): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return [...items].sort((left, right) => collator.compare(nameOf(left.path), nameOf(right.path)));
}

export function moveToSlot<T extends { id: string }>(items: T[], id: string, slot: number): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return items;
  const target = Math.max(0, Math.min(items.length, slot));
  const insertAt = target > from ? target - 1 : target;
  if (insertAt === from) return items;
  const next = items.filter((item) => item.id !== id);
  next.splice(insertAt, 0, items[from]);
  return next;
}

export function sortedByPageCount<T extends { pageCount?: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => (left.pageCount ?? Number.MAX_SAFE_INTEGER) - (right.pageCount ?? Number.MAX_SAFE_INTEGER));
}
