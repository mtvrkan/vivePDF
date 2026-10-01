import type { PdfPageGeometry } from "@embedpdf/models";
import type { GlyphPointer, SelectionRangeX } from "@embedpdf/plugin-selection";

export const DRAG_MIN_PX = 4;

function gap(value: number, start: number, size: number): number {
  if (value < start) return start - value;
  if (value > start + size) return value - (start + size);
  return 0;
}

export function nearestGlyph(geometry: PdfPageGeometry, x: number, y: number): number | null {
  let best: { index: number; across: number; along: number } | null = null;
  for (const run of geometry.runs) {
    for (const [offset, glyph] of run.glyphs.entries()) {
      if (glyph.width <= 0 || glyph.height <= 0) continue;
      const across = gap(y, glyph.y, glyph.height);
      const along = gap(x, glyph.x, glyph.width);
      if (!best || across < best.across || (across === best.across && along < best.along)) {
        best = { index: run.charStart + offset, across, along };
      }
    }
  }
  return best?.index ?? null;
}

function before(a: GlyphPointer, b: GlyphPointer): boolean {
  return a.page < b.page || (a.page === b.page && a.index < b.index);
}

export function releasedRange(start: GlyphPointer, end: GlyphPointer): SelectionRangeX {
  return before(end, start) ? { start: end, end: start } : { start, end };
}
