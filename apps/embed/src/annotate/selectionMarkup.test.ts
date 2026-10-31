import { describe, expect, it } from "vitest";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { markupRequests, markupSubtype } from "./selectionMarkup";

const box = (x: number, y: number, width: number, height: number) => ({ origin: { x, y }, size: { width, height } });

describe("marking text that is already selected", () => {
  it("makes one mark per page that wraps every selected line", () => {
    const requests = markupRequests({ 2: [box(10, 10, 50, 8)], 0: [box(10, 20, 100, 10), box(10, 32, 40, 10)] });

    expect(requests).toEqual([
      { pageIndex: 0, rect: box(10, 20, 100, 22), segmentRects: [box(10, 20, 100, 10), box(10, 32, 40, 10)] },
      { pageIndex: 2, rect: box(10, 10, 50, 8), segmentRects: [box(10, 10, 50, 8)] },
    ]);
  });

  it("skips pages without selected text", () => {
    expect(markupRequests({ 0: [], 1: [] })).toEqual([]);
  });

  it("knows which tools mark text", () => {
    const subtypes = [markupSubtype("highlight"), markupSubtype("strikeout"), markupSubtype("ink")];

    expect(subtypes).toEqual([PdfAnnotationSubtype.HIGHLIGHT, PdfAnnotationSubtype.STRIKEOUT, null]);
  });
});
