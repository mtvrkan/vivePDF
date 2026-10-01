import type { PosterOrientation, PosterPaper } from "@/types";

export const POSTER_PAPERS: Record<PosterPaper, [number, number]> = {
  a4: [595, 842],
  a3: [842, 1191],
  letter: [612, 792],
  legal: [612, 1008],
};

export const POSTER_GRID = { min: 1, max: 10 };
export const POSTER_MARGIN_MM = { min: 0, max: 50 };
export const POSTER_OVERLAP_MM = { min: 0, max: 50 };

const PT_TO_MM = 25.4 / 72;
const MM_TO_PT = 72 / 25.4;
const EMPTY_EXTENT = 0.5;
const THIN_SHARE = 0.2;

export type PosterSettings = {
  paper: PosterPaper;
  orientation: PosterOrientation;
  columns: number;
  rows: number;
  marginMm: number;
  overlapMm: number;
  cutMarks: boolean;
  labels: boolean;
  pages: string;
};

export function posterGridOf(settings: PosterSettings) {
  return {
    paper: settings.paper,
    orientation: settings.orientation,
    columns: Math.min(10, Math.max(1, Math.floor(settings.columns) || 1)),
    rows: Math.min(10, Math.max(1, Math.floor(settings.rows) || 1)),
    margin: Math.min(144, Math.max(0, settings.marginMm * MM_TO_PT)),
    overlap: Math.min(144, Math.max(0, settings.overlapMm * MM_TO_PT)),
  };
}

export type PosterGrid = {
  paper: PosterPaper;
  orientation: PosterOrientation;
  columns: number;
  rows: number;
  margin: number;
  overlap: number;
};

export type PosterPlan = {
  landscape: boolean;
  scale: number;
  widthMm: number;
  heightMm: number;
  placed: { x: number; y: number; width: number; height: number };
  total: { width: number; height: number };
  step: { x: number; y: number };
  printable: { width: number; height: number };
  columnShares: number[];
  rowShares: number[];
  sheets: number;
  thin: boolean;
};

function shares(count: number, step: number, printable: number, start: number, length: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const shown = Math.min(index * step + printable, start + length) - Math.max(index * step, start);
    return shown < EMPTY_EXTENT ? 0 : shown / printable;
  });
}

export function tileUsed(plan: PosterPlan, column: number, row: number): boolean {
  return (plan.columnShares[column] ?? 0) > 0 && (plan.rowShares[row] ?? 0) > 0;
}

function sheetSizes(paper: PosterPaper, orientation: PosterOrientation): Array<[number, number]> {
  const [short, long] = [...POSTER_PAPERS[paper]].sort((a, b) => a - b);
  if (orientation === "portrait") return [[short, long]];
  if (orientation === "landscape") return [[long, short]];
  return [
    [short, long],
    [long, short],
  ];
}

export function posterPlan(page: { width: number; height: number }, grid: PosterGrid): PosterPlan | null {
  if (page.width <= 0 || page.height <= 0) return null;
  let best: PosterPlan | null = null;
  for (const [sheetWidth, sheetHeight] of sheetSizes(grid.paper, grid.orientation)) {
    const printableWidth = sheetWidth - 2 * grid.margin;
    const printableHeight = sheetHeight - 2 * grid.margin;
    if (printableWidth <= grid.overlap || printableHeight <= grid.overlap) continue;
    const totalWidth = grid.columns * printableWidth - (grid.columns - 1) * grid.overlap;
    const totalHeight = grid.rows * printableHeight - (grid.rows - 1) * grid.overlap;
    const scale = Math.min(totalWidth / page.width, totalHeight / page.height);
    const width = page.width * scale;
    const height = page.height * scale;
    const placedX = (totalWidth - width) / 2;
    const placedY = (totalHeight - height) / 2;
    const stepX = printableWidth - grid.overlap;
    const stepY = printableHeight - grid.overlap;
    const columnShares = shares(grid.columns, stepX, printableWidth, placedX, width);
    const rowShares = shares(grid.rows, stepY, printableHeight, placedY, height);
    const used = (values: number[]) => values.filter((value) => value > 0).length;
    const plan: PosterPlan = {
      landscape: sheetWidth > sheetHeight,
      scale,
      widthMm: width * PT_TO_MM,
      heightMm: height * PT_TO_MM,
      placed: { x: placedX, y: placedY, width, height },
      total: { width: totalWidth, height: totalHeight },
      step: { x: stepX, y: stepY },
      printable: { width: printableWidth, height: printableHeight },
      columnShares,
      rowShares,
      sheets: used(columnShares) * used(rowShares),
      thin: [...columnShares, ...rowShares].some((share) => share < THIN_SHARE),
    };
    if (!best || plan.scale > best.scale) best = plan;
  }
  return best;
}

export function tileName(column: number, row: number): string {
  let letters = "";
  let value = row;
  for (;;) {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
    if (value < 0) return `${letters}${column + 1}`;
  }
}

export function visiblePageSize(size: { width: number; height: number; rotation: number } | undefined): { width: number; height: number } | null {
  if (!size) return null;
  return { width: size.width, height: size.height };
}
