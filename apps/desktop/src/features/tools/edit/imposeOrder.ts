import type { ImposeArrangement, ImposeLayout, ImposeReading } from "@/types";

export const IMPOSE_GRIDS: Record<Exclude<ImposeLayout, "custom">, [number, number]> = {
  "2up": [2, 1],
  "3up": [3, 1],
  "4up": [2, 2],
  "6up": [3, 2],
  "8up": [4, 2],
  "9up": [3, 3],
  "12up": [4, 3],
  "16up": [4, 4],
  booklet: [2, 1],
};

export const IMPOSE_MARGIN_MM = { min: 0, max: 25 };
export const IMPOSE_GAP_MM = { min: 0, max: 17 };
export const IMPOSE_GUTTER_MM = { min: 0, max: 25 };
export const IMPOSE_GRID = { min: 1, max: 12 };

export function hasSpine(columns: number): boolean {
  return columns % 2 === 0;
}

export function gridOf(layout: ImposeLayout, columns: number, rows: number): [number, number] {
  if (layout !== "custom") return IMPOSE_GRIDS[layout];
  return [Math.min(12, Math.max(1, Math.floor(columns) || 1)), Math.min(12, Math.max(1, Math.floor(rows) || 1))];
}

export function cellOrder(columns: number, rows: number, arrangement: ImposeArrangement, reading: ImposeReading): number[] {
  const across = reading === "ltr" ? range(columns) : range(columns).reverse();
  const order: number[] = [];
  if (arrangement === "rows") {
    for (const row of range(rows)) order.push(...across.map((column) => row * columns + column));
  } else {
    for (const column of across) order.push(...range(rows).map((row) => row * columns + column));
  }
  return order;
}

export function slotLabels(columns: number, rows: number, arrangement: ImposeArrangement, reading: ImposeReading): number[] {
  const labels = new Array<number>(columns * rows).fill(0);
  cellOrder(columns, rows, arrangement, reading).forEach((slot, index) => {
    labels[slot] = index + 1;
  });
  return labels;
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}
