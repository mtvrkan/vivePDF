import { describe, expect, it } from "vitest";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import { allMarks, areaBetween, marksInArea, useAreaSelectStore } from "./markArea";

const mark = (id: string, type: PdfAnnotationSubtype, x: number, y: number, pageIndex = 0) =>
  ({ id, type, pageIndex, rect: { origin: { x, y }, size: { width: 20, height: 10 } } }) as PdfAnnotationObject;

describe("marksInArea", () => {
  it("picks the marks the dragged area touches", () => {
    const objects = [mark("a", PdfAnnotationSubtype.INK, 10, 10), mark("b", PdfAnnotationSubtype.SQUARE, 100, 100), mark("c", PdfAnnotationSubtype.HIGHLIGHT, 25, 15)];
    expect(marksInArea(objects, { origin: { x: 0, y: 0 }, size: { width: 30, height: 20 } }).map((object) => object.id)).toEqual(["a", "c"]);
  });

  it("leaves links and form fields alone", () => {
    const objects = [mark("link", PdfAnnotationSubtype.LINK, 10, 10), mark("field", PdfAnnotationSubtype.WIDGET, 10, 10)];
    expect(marksInArea(objects, { origin: { x: 0, y: 0 }, size: { width: 100, height: 100 } })).toEqual([]);
  });

  it("finds nothing in an area that misses every mark", () => {
    expect(marksInArea([mark("a", PdfAnnotationSubtype.INK, 10, 10)], { origin: { x: 200, y: 200 }, size: { width: 5, height: 5 } })).toEqual([]);
  });
});

describe("allMarks", () => {
  it("lists every drawn mark across pages and skips links", () => {
    const byUid = {
      a: { object: mark("a", PdfAnnotationSubtype.INK, 0, 0, 0) },
      b: { object: mark("b", PdfAnnotationSubtype.FREETEXT, 0, 0, 2) },
      c: { object: mark("c", PdfAnnotationSubtype.LINK, 0, 0, 1) },
    };
    expect(allMarks(byUid)).toEqual([
      { pageIndex: 0, id: "a" },
      { pageIndex: 2, id: "b" },
    ]);
  });
});

describe("areaBetween", () => {
  it("turns a drag in either direction into a page rectangle", () => {
    expect(areaBetween({ x: 60, y: 40 }, { x: 20, y: 100 }, 2)).toEqual({ origin: { x: 10, y: 20 }, size: { width: 20, height: 30 } });
  });
});

describe("useAreaSelectStore", () => {
  it("toggles area selection per document and stops it", () => {
    useAreaSelectStore.getState().toggle("doc-1");
    expect(useAreaSelectStore.getState().documentId).toBe("doc-1");
    useAreaSelectStore.getState().toggle("doc-1");
    expect(useAreaSelectStore.getState().documentId).toBeNull();
    useAreaSelectStore.getState().toggle("doc-2");
    useAreaSelectStore.getState().stop();
    expect(useAreaSelectStore.getState().documentId).toBeNull();
  });
});
