import { frameToScreen, type QuarterTurns } from "./pageFrame";

export type PageArea = { x0: number; y0: number; x1: number; y1: number };
export type ScreenRect = { left: number; top: number; width: number; height: number };
export type TextLine = { text: string; x0: number; x1: number };

export const MIN_AREA_SIDE = 6;
const MIN_CODE_LINES = 3;
const CODE_HINTS = /[{}();=<>]|^\s*(def|class|function|import|from|const|let|var|public|private|return|if|for|while|#include)\b/;

export function normalizeArea(area: PageArea): PageArea {
  return {
    x0: Math.min(area.x0, area.x1),
    y0: Math.min(area.y0, area.y1),
    x1: Math.max(area.x0, area.x1),
    y1: Math.max(area.y0, area.y1),
  };
}

export function isUsableArea(area: PageArea, minSide = MIN_AREA_SIDE): boolean {
  const box = normalizeArea(area);
  return box.x1 - box.x0 >= minSide && box.y1 - box.y0 >= minSide;
}

export function screenRectFor(anchor: ScreenRect, scale: number, area: PageArea, viewTurns: QuarterTurns = 0): ScreenRect {
  const box = normalizeArea(area);
  return frameToScreen({ x: box.x0 * scale, y: box.y0 * scale, width: (box.x1 - box.x0) * scale, height: (box.y1 - box.y0) * scale }, anchor, viewTurns);
}

export function looksLikeCode(lines: TextLine[]): boolean {
  if (lines.length < MIN_CODE_LINES) return false;
  const hinted = lines.filter((line) => CODE_HINTS.test(line.text)).length;
  if (hinted >= 2) return true;
  const starts = new Set(lines.map((line) => Math.round(line.x0)));
  return starts.size >= 2 && lines.length >= MIN_CODE_LINES + 2;
}
