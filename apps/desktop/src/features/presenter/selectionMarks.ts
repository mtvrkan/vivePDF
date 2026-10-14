export const MAX_SELECTION_RECTS = 2000;

export type UnitRect = { x: number; y: number; width: number; height: number };

export type SelectionMarks = { color: string; pages: Record<number, UnitRect[]> };

type PdfRect = { origin: { x: number; y: number }; size: { width: number; height: number } };

type PageSize = { width: number; height: number };

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

export function toSelectionMarks(rects: Record<string, PdfRect[]> | null | undefined, pageSize: (pageIndex: number) => PageSize | null, color: string): SelectionMarks | null {
  const pages: Record<number, UnitRect[]> = {};
  let total = 0;
  for (const [key, items] of Object.entries(rects ?? {})) {
    const pageIndex = Number(key);
    const size = pageSize(pageIndex);
    if (!Number.isInteger(pageIndex) || !size || size.width <= 0 || size.height <= 0) continue;
    const marks: UnitRect[] = [];
    for (const item of items) {
      if (total >= MAX_SELECTION_RECTS) break;
      const x = clampUnit(item.origin.x / size.width);
      const y = clampUnit(item.origin.y / size.height);
      const width = clampUnit((item.origin.x + item.size.width) / size.width) - x;
      const height = clampUnit((item.origin.y + item.size.height) / size.height) - y;
      if (width <= 0 || height <= 0) continue;
      marks.push({ x, y, width, height });
      total += 1;
    }
    if (marks.length > 0) pages[pageIndex] = marks;
  }
  return total > 0 ? { color, pages } : null;
}
