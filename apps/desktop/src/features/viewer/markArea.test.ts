import { describe, expect, it } from "vitest";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import { MAX_ERASER_SIZE, MIN_ERASER_SIZE, allMarks, areaBetween, marksInArea, useMarkToolStore } from "./markArea";

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

describe("useMarkToolStore", () => {
  it("toggles a tool per document, switches between tools and stops", () => {
    const store = useMarkToolStore.getState;

    store().toggle("doc-1", "area");
    expect(store()).toMatchObject({ documentId: "doc-1", mode: "area" });
    store().toggle("doc-1", "erase");
    expect(store()).toMatchObject({ documentId: "doc-1", mode: "erase" });
    store().toggle("doc-1", "erase");
    expect(store()).toMatchObject({ documentId: null, mode: null });
    store().toggle("doc-2", "area");
    store().stop();

    expect(store().mode).toBeNull();
  });

  it("keeps the eraser size within its range", () => {
    useMarkToolStore.getState().setEraserSize(1000);
    expect(useMarkToolStore.getState().eraserSize).toBe(MAX_ERASER_SIZE);
    useMarkToolStore.getState().setEraserSize(0);
    expect(useMarkToolStore.getState().eraserSize).toBe(MIN_ERASER_SIZE);
  });
});
