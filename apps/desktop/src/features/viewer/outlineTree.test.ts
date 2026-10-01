import { describe, expect, it } from "vitest";
import { PdfActionType, type PdfBookmarkObject } from "@embedpdf/models";
import { activeOutlineId, ancestorIds, flattenOutline, shownActiveId, visibleOutline } from "./outlineTree";

const toPage = (pageIndex: number) => ({ type: "destination", destination: { pageIndex, zoom: { mode: 0 }, view: [] } }) as unknown as PdfBookmarkObject["target"];

const outline: PdfBookmarkObject[] = [
  { title: "Preface", target: toPage(0) },
  {
    title: "Chapter 1   Introduction",
    target: toPage(2),
    children: [
      { title: "1.1 Method", target: { type: "action", action: { type: PdfActionType.Goto, destination: { pageIndex: 3 } } } as unknown as PdfBookmarkObject["target"] },
      { title: "1.2 Sonuçlar", target: toPage(4) },
    ],
  },
  { title: "Dataset", target: { type: "action", action: { type: PdfActionType.URI, uri: "https://example.org/data" } } as unknown as PdfBookmarkObject["target"] },
  { title: "Chapter 2", target: toPage(5) },
];

describe("outline tree", () => {
  it("flattens nested bookmarks with depth, pages and links", () => {
    const rows = flattenOutline(outline);
    expect(rows.map((row) => [row.id, row.depth, row.pageIndex, row.hasChildren])).toEqual([
      ["0", 0, 0, false],
      ["1", 0, 2, true],
      ["1.0", 1, 3, false],
      ["1.1", 1, 4, false],
      ["2", 0, null, false],
      ["3", 0, 5, false],
    ]);
    expect(rows[1].title).toBe("Chapter 1 Introduction");
    expect(rows[4].uri).toBe("https://example.org/data");
    expect(ancestorIds("1.0.2")).toEqual(["1", "1.0"]);
  });

  it("marks the deepest heading at or before the current page", () => {
    const rows = flattenOutline(outline);
    expect(activeOutlineId(rows, 4)).toBe("1.1");
    expect(activeOutlineId(rows, 3)).toBe("1.0");
    expect(activeOutlineId(rows, 7)).toBe("3");
    expect(activeOutlineId(flattenOutline([{ title: "Late", target: toPage(4) }]), 1)).toBeNull();
  });

  it("hides collapsed branches, filters with ancestors and falls back to a shown parent", () => {
    const rows = flattenOutline(outline);
    const collapsed = visibleOutline(rows, new Set(), "");
    expect(collapsed.map((row) => row.id)).toEqual(["0", "1", "2", "3"]);
    expect(shownActiveId(collapsed, "1.1")).toBe("1");
    expect(visibleOutline(rows, new Set(["1"]), "").map((row) => row.id)).toEqual(["0", "1", "1.0", "1.1", "2", "3"]);
    expect(visibleOutline(rows, new Set(), "sonuclar").map((row) => row.id)).toEqual(["1", "1.1"]);
    expect(visibleOutline(rows, new Set(), "missing")).toEqual([]);
    expect(shownActiveId([], "1")).toBeNull();
  });
});
