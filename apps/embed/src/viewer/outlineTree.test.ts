import { PdfActionType, PdfZoomMode, type PdfBookmarkObject } from "@embedpdf/models";
import { describe, expect, it } from "vitest";
import { activeRowId, flattenOutline, treeMove, visibleRows } from "./outlineTree";

const page = (pageIndex: number) => ({ type: "destination" as const, destination: { pageIndex, zoom: { mode: PdfZoomMode.FitPage }, view: [] } });

const BOOKMARKS = [
  { title: "Genel  bakış", target: page(0) },
  {
    title: "Finansal sonuçlar",
    target: page(11),
    children: [
      { title: "Gelir", target: page(12) },
      { title: "Giderler", target: page(16) },
    ],
  },
  { title: "Web sitesi", target: { type: "action", action: { type: PdfActionType.URI, uri: "https://vivepdf.com" } } },
] as PdfBookmarkObject[];

describe("flattenOutline", () => {
  it("lists bookmarks in reading order with depth, page and link", () => {
    const rows = flattenOutline(BOOKMARKS);

    expect(rows.map((row) => [row.id, row.depth, row.title, row.pageIndex, row.uri])).toEqual([
      ["0", 0, "Genel bakış", 0, null],
      ["1", 0, "Finansal sonuçlar", 11, null],
      ["1.0", 1, "Gelir", 12, null],
      ["1.1", 1, "Giderler", 16, null],
      ["2", 0, "Web sitesi", null, "https://vivepdf.com"],
    ]);
  });
});

describe("visibleRows and activeRowId", () => {
  it("hides children of collapsed rows", () => {
    const rows = flattenOutline(BOOKMARKS);

    const ids = [visibleRows(rows, new Set()).map((row) => row.id), visibleRows(rows, new Set(["1"])).map((row) => row.id)];

    expect(ids).toEqual([
      ["0", "1", "2"],
      ["0", "1", "1.0", "1.1", "2"],
    ]);
  });

  it("marks the deepest section that starts on or before the current page", () => {
    const rows = flattenOutline(BOOKMARKS);

    const active = [activeRowId(rows, 0), activeRowId(rows, 14), activeRowId(rows, 400)];

    expect(active).toEqual(["0", "1.0", "1.1"]);
  });

  it("returns nothing for an empty outline", () => {
    const active = activeRowId([], 3);

    expect(active).toBeNull();
  });
});

describe("treeMove", () => {
  const rows = flattenOutline(BOOKMARKS);
  const open = new Set(["1"]);
  const visible = visibleRows(rows, open);

  it("moves with the arrow keys and jumps with Home and End", () => {
    const moves = [treeMove(visible, "0", "ArrowDown", open), treeMove(visible, "1.0", "ArrowUp", open), treeMove(visible, "1", "End", open)];

    expect(moves).toEqual([{ focus: "1" }, { focus: "1" }, { focus: "2" }]);
  });

  it("opens, enters, closes and leaves a branch with the side arrows", () => {
    const closed = new Set<string>();

    const moves = [treeMove(visibleRows(rows, closed), "1", "ArrowRight", closed), treeMove(visible, "1", "ArrowRight", open), treeMove(visible, "1.1", "ArrowLeft", open), treeMove(visible, "1", "ArrowLeft", open)];

    expect(moves).toEqual([{ toggle: "1" }, { focus: "1.0" }, { focus: "1" }, { toggle: "1" }]);
  });

  it("activates with Enter and ignores other keys", () => {
    const moves = [treeMove(visible, "1.1", "Enter", open), treeMove(visible, "1.1", "x", open)];

    expect(moves).toEqual([{ activate: "1.1" }, null]);
  });
});
