import { describe, expect, it } from "vitest";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { MARKUP_SUBTYPES, boundingRect, hasSelectionRects, markupRequests } from "./selectionMarkup";

const rect = (x: number, y: number, width: number, height: number) => ({ origin: { x, y }, size: { width, height } });

describe("boundingRect", () => {
  it("covers every segment", () => {
    expect(boundingRect([rect(10, 10, 30, 8), rect(5, 22, 50, 8)])).toEqual(rect(5, 10, 50, 20));
  });

  it("returns an empty rect when there is nothing to cover", () => {
    expect(boundingRect([])).toEqual(rect(0, 0, 0, 0));
  });
});

describe("markupRequests", () => {
  it("makes one request per page and keeps the segments", () => {
    const requests = markupRequests({ "2": [rect(0, 0, 10, 5)], "0": [rect(1, 1, 4, 4), rect(1, 6, 9, 4)] });
    expect(requests.map((entry) => entry.pageIndex)).toEqual([0, 2]);
    expect(requests[0].segmentRects).toHaveLength(2);
    expect(requests[0].rect).toEqual(rect(1, 1, 9, 9));
  });

  it("skips pages with no segments", () => {
    expect(markupRequests({ "0": [], "1": [rect(0, 0, 1, 1)] }).map((entry) => entry.pageIndex)).toEqual([1]);
  });

  it("returns nothing when there is no selection", () => {
    expect(markupRequests({})).toEqual([]);
  });
});

describe("hasSelectionRects", () => {
  it("is false for nothing, an empty map and empty pages", () => {
    expect(hasSelectionRects(null)).toBe(false);
    expect(hasSelectionRects({})).toBe(false);
    expect(hasSelectionRects({ "0": [] })).toBe(false);
  });

  it("is true as soon as one page has a segment", () => {
    expect(hasSelectionRects({ "0": [], "3": [rect(0, 0, 1, 1)] })).toBe(true);
  });
});

describe("MARKUP_SUBTYPES", () => {
  it("maps every text marking tool to its PDF subtype", () => {
    expect(MARKUP_SUBTYPES.highlight).toBe(PdfAnnotationSubtype.HIGHLIGHT);
    expect(MARKUP_SUBTYPES.underline).toBe(PdfAnnotationSubtype.UNDERLINE);
    expect(MARKUP_SUBTYPES.strikeout).toBe(PdfAnnotationSubtype.STRIKEOUT);
    expect(MARKUP_SUBTYPES.squiggly).toBe(PdfAnnotationSubtype.SQUIGGLY);
  });
});
