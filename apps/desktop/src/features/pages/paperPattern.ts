import type { PaperPattern, PaperStyle } from "@/types";

export const MM = 72 / 25.4;
export const PAPER_STYLES: readonly PaperStyle[] = ["lined", "grid", "dots", "isometric", "handwriting", "staff"];
export const PAPER_SPACING = { min: 2, max: 30, step: 0.5 } as const;
export const DEFAULT_PAPER_COLOR = "#9bb4d0";
export const MARGIN_COLOR = "#de6666";

const INSET_MM = 10;
const MARGIN_OFFSET_MM = 20;
const EPSILON = 1e-6;

export const DEFAULT_SPACING: Record<PaperStyle, number> = {
  lined: 8,
  grid: 5,
  dots: 5,
  isometric: 6,
  handwriting: 4,
  staff: 2,
};

export type LineKind = "rule" | "guide" | "margin";
export type PaperLine = { x0: number; y0: number; x1: number; y1: number; kind: LineKind };
export type PaperMarks = { lines: PaperLine[]; dots: [number, number][]; dotRadius: number };

type Box = { left: number; top: number; right: number; bottom: number };

function count(length: number, step: number): number {
  return Math.max(0, Math.floor(length / step + EPSILON));
}

function bandedRows(box: Box, step: number, lines: number, gap: number): number[] {
  const band = (lines - 1) * step;
  const rows: number[] = [];
  for (let y = box.top + step; y + band <= box.bottom + EPSILON; y += band + gap) {
    for (let index = 0; index < lines; index += 1) rows.push(y + index * step);
  }
  return rows;
}

function lattice(width: number, height: number, box: Box, step: number) {
  const columns = count(box.right - box.left, step);
  const rows = count(box.bottom - box.top, step);
  return { columns, rows, x0: (width - columns * step) / 2, y0: (height - rows * step) / 2 };
}

function horizontal(box: Box, y: number, kind: LineKind): PaperLine {
  return { x0: box.left, y0: y, x1: box.right, y1: y, kind };
}

export function paperMarks(width: number, height: number, pattern: PaperPattern): PaperMarks {
  const step = pattern.spacing * MM;
  const inset = INSET_MM * MM;
  const box: Box = { left: inset, top: inset, right: width - inset, bottom: height - inset };
  const marks: PaperMarks = { lines: [], dots: [], dotRadius: Math.min(1.2, Math.max(0.5, step * 0.05)) };
  if (box.right - box.left < step || box.bottom - box.top < step) return marks;
  switch (pattern.style) {
    case "lined": {
      for (let index = 1; index <= count(box.bottom - box.top, step); index += 1) marks.lines.push(horizontal(box, box.top + index * step, "rule"));
      const x = box.left + MARGIN_OFFSET_MM * MM;
      if (pattern.margin && x < box.right) marks.lines.push({ x0: x, y0: box.top, x1: x, y1: box.bottom, kind: "margin" });
      break;
    }
    case "grid": {
      const { columns, rows, x0, y0 } = lattice(width, height, box, step);
      if (!columns || !rows) break;
      for (let column = 0; column <= columns; column += 1) marks.lines.push({ x0: x0 + column * step, y0, x1: x0 + column * step, y1: y0 + rows * step, kind: "rule" });
      for (let row = 0; row <= rows; row += 1) marks.lines.push({ x0, y0: y0 + row * step, x1: x0 + columns * step, y1: y0 + row * step, kind: "rule" });
      break;
    }
    case "dots": {
      const { columns, rows, x0, y0 } = lattice(width, height, box, step);
      for (let row = 0; row <= rows; row += 1) for (let column = 0; column <= columns; column += 1) marks.dots.push([x0 + column * step, y0 + row * step]);
      break;
    }
    case "isometric": {
      const rowHeight = (step * Math.sqrt(3)) / 2;
      const columns = count(box.right - box.left, step);
      const rows = count(box.bottom - box.top, rowHeight);
      const x0 = (width - columns * step) / 2;
      const y0 = (height - rows * rowHeight) / 2;
      for (let row = 0; row <= rows; row += 1) {
        const odd = row % 2 === 1;
        for (let column = 0; column < (odd ? columns : columns + 1); column += 1) marks.dots.push([x0 + column * step + (odd ? step / 2 : 0), y0 + row * rowHeight]);
      }
      break;
    }
    case "handwriting":
      bandedRows(box, step, 4, 2 * step).forEach((y, index) => marks.lines.push(horizontal(box, y, index % 4 === 1 || index % 4 === 2 ? "guide" : "rule")));
      break;
    case "staff":
      bandedRows(box, step, 5, 6 * step).forEach((y) => marks.lines.push(horizontal(box, y, "rule")));
      break;
  }
  return marks;
}
