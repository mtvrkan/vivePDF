import { describe, expect, it } from "vitest";
import type { PdfPageGeometry } from "@embedpdf/models";
import { nearestGlyph, releasedRange } from "./selectionRelease";

const line = (charStart: number, top: number, count: number, width = 10, left = 72) => ({
  rect: { x: left, y: top, width: count * width, height: 18 },
  charStart,
  fontSize: 18,
  glyphs: Array.from({ length: count }, (_, offset) => ({ x: left + offset * width, y: top, width, height: 18, flags: 0, tightX: undefined, tightY: undefined, tightWidth: undefined, tightHeight: undefined })),
});

const page = { runs: [line(0, 72, 21), line(22, 108, 28)] } as PdfPageGeometry;

describe("nearestGlyph", () => {
  it("takes the last glyph of the line when the drag ends past its end", () => {
    expect(nearestGlyph(page, 480, 84)).toBe(20);
  });

  it("takes the line under the release point before the horizontally nearer one", () => {
    expect(nearestGlyph(page, 480, 120)).toBe(49);
    expect(nearestGlyph(page, 20, 84)).toBe(0);
  });

  it("falls back to the vertically nearest line below the text", () => {
    expect(nearestGlyph(page, 100, 600)).toBe(24);
  });

  it("skips glyphs with no size", () => {
    const empty = { runs: [{ ...line(0, 72, 3), glyphs: line(0, 72, 3).glyphs.map((glyph) => ({ ...glyph, width: 0 })) }, line(3, 300, 2)] } as PdfPageGeometry;
    expect(nearestGlyph(empty, 80, 80)).toBe(3);
  });

  it("finds nothing on a page without text", () => {
    expect(nearestGlyph({ runs: [] }, 10, 10)).toBeNull();
  });
});

describe("releasedRange", () => {
  it("keeps a forward drag as it is", () => {
    expect(releasedRange({ page: 0, index: 3 }, { page: 0, index: 20 })).toEqual({ start: { page: 0, index: 3 }, end: { page: 0, index: 20 } });
  });

  it("orders a backward drag, across pages too", () => {
    expect(releasedRange({ page: 0, index: 20 }, { page: 0, index: 3 })).toEqual({ start: { page: 0, index: 3 }, end: { page: 0, index: 20 } });
    expect(releasedRange({ page: 2, index: 1 }, { page: 1, index: 90 })).toEqual({ start: { page: 1, index: 90 }, end: { page: 2, index: 1 } });
  });
});
