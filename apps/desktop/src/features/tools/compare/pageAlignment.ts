import type { PageDiff } from "@/types";

export type AlignedRow = { row: number; a: number | null; b: number | null };

export type Alignment = {
  rows: AlignedRow[];
  toB: (pageA: number) => number | null;
  toA: (pageB: number) => number | null;
  rowOfA: (pageA: number) => number | null;
  rowOfB: (pageB: number) => number | null;
};

export function alignedRows(pages: PageDiff[] | null, totalA: number, totalB: number): AlignedRow[] {
  if (pages && pages.length > 0) return pages.map((page) => ({ row: page.page, a: page.pageA, b: page.pageB }));
  return Array.from({ length: Math.max(totalA, totalB) }, (_, index) => ({
    row: index + 1,
    a: index < totalA ? index + 1 : null,
    b: index < totalB ? index + 1 : null,
  }));
}

function partnerNear(rows: AlignedRow[], index: number, pick: (row: AlignedRow) => number | null): number | null {
  for (let step = 0; step < rows.length; step += 1) {
    const before = rows[index - step];
    if (before && pick(before) !== null) return pick(before);
    const after = rows[index + step];
    if (after && pick(after) !== null) return pick(after);
  }
  return null;
}

export function alignmentFrom(pages: PageDiff[] | null, totalA: number, totalB: number): Alignment {
  const rows = alignedRows(pages, totalA, totalB);
  const indexOfA = new Map<number, number>();
  const indexOfB = new Map<number, number>();
  rows.forEach((row, index) => {
    if (row.a !== null) indexOfA.set(row.a, index);
    if (row.b !== null) indexOfB.set(row.b, index);
  });
  return {
    rows,
    toB: (pageA) => {
      const index = indexOfA.get(pageA);
      return index === undefined ? null : partnerNear(rows, index, (row) => row.b);
    },
    toA: (pageB) => {
      const index = indexOfB.get(pageB);
      return index === undefined ? null : partnerNear(rows, index, (row) => row.a);
    },
    rowOfA: (pageA) => {
      const index = indexOfA.get(pageA);
      return index === undefined ? null : rows[index].row;
    },
    rowOfB: (pageB) => {
      const index = indexOfB.get(pageB);
      return index === undefined ? null : rows[index].row;
    },
  };
}

export function nextChange<T extends { row: number }>(changes: T[], currentRow: number, direction: 1 | -1): T | null {
  if (direction === 1) return changes.find((change) => change.row > currentRow) ?? null;
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    if (changes[index].row < currentRow) return changes[index];
  }
  return null;
}

export function changePosition<T extends { row: number }>(changes: T[], currentRow: number): number {
  return changes.findIndex((change) => change.row === currentRow) + 1;
}
