import { describe, expect, it, vi } from "vitest";
import { PdfAnnotationSubtype, type PdfAnnotationObject, type Rect } from "@embedpdf/models";
import { markSelectionWithTool, markupSelection } from "./markupSelection";

function rect(x: number, y: number, width: number, height: number): Rect {
  return { origin: { x, y }, size: { width, height } };
}

function fakes(rects: Record<string, Rect[]>) {
  const created: Array<{ pageIndex: number; annotation: PdfAnnotationObject }> = [];
  const annotation = { createAnnotation: vi.fn((pageIndex: number, object: PdfAnnotationObject) => created.push({ pageIndex, annotation: object })) };
  const selection = { getHighlightRects: vi.fn(() => rects), clear: vi.fn() };
  return { annotation, selection, created };
}

describe("markupSelection", () => {
  it("creates one mark per page from the selection rects with the given subtype and colour", () => {
    const { annotation, selection, created } = fakes({ "2": [rect(10, 20, 30, 5)], "0": [rect(0, 0, 10, 5), rect(0, 10, 20, 5)] });

    const count = markupSelection({ annotation, selection, toolId: "underline", color: "#E5484D", opacity: 0.5 });

    expect(count).toBe(2);
    expect(created.map((entry) => entry.pageIndex)).toEqual([0, 2]);
    expect(created[0].annotation).toMatchObject({
      type: PdfAnnotationSubtype.UNDERLINE,
      pageIndex: 0,
      color: "#E5484D",
      strokeColor: "#E5484D",
      opacity: 0.5,
      rect: rect(0, 0, 20, 15),
      segmentRects: [rect(0, 0, 10, 5), rect(0, 10, 20, 5)],
    });
    expect(selection.clear).toHaveBeenCalledTimes(1);
  });

  it("does nothing and keeps the selection when nothing is selected", () => {
    const { annotation, selection } = fakes({ "0": [] });

    const count = markupSelection({ annotation, selection, toolId: "highlight", color: "#FFD400" });

    expect(count).toBe(0);
    expect(annotation.createAnnotation).not.toHaveBeenCalled();
    expect(selection.clear).not.toHaveBeenCalled();
  });

  it("ignores tools that are not text markups", () => {
    const { annotation, selection } = fakes({ "0": [rect(0, 0, 10, 5)] });

    const count = markupSelection({ annotation, selection, toolId: "ink", color: "#FFD400" });

    expect(count).toBe(0);
    expect(annotation.createAnnotation).not.toHaveBeenCalled();
  });

  it("does nothing without an annotation scope", () => {
    const { selection } = fakes({ "0": [rect(0, 0, 10, 5)] });

    const count = markupSelection({ annotation: null, selection, toolId: "highlight", color: "#FFD400" });

    expect(count).toBe(0);
    expect(selection.clear).not.toHaveBeenCalled();
  });
});

describe("markSelectionWithTool", () => {
  it("uses the colour and defaults remembered for the tool", () => {
    const { annotation, selection, created } = fakes({ "0": [rect(0, 0, 10, 5)] });
    const tools = { getTool: (toolId: string) => (toolId === "strikeout" ? { defaults: { strokeColor: "#3E63DD", opacity: 0.8, author: "Ayşe" } } : undefined) };

    markSelectionWithTool(tools, annotation, selection, "strikeout");

    expect(created[0].annotation).toMatchObject({ type: PdfAnnotationSubtype.STRIKEOUT, strokeColor: "#3E63DD", color: "#3E63DD", opacity: 0.8, author: "Ayşe" });
  });

  it("falls back to the first preset colour when the tool is unknown", () => {
    const { annotation, selection, created } = fakes({ "0": [rect(0, 0, 10, 5)] });

    markSelectionWithTool(null, annotation, selection, "highlight");

    expect(created[0].annotation).toMatchObject({ type: PdfAnnotationSubtype.HIGHLIGHT, color: "#FFD400" });
  });
});
