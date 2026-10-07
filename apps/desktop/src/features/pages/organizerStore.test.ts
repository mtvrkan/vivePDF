import { beforeEach, describe, expect, it } from "vitest";
import type { OrganizerTile } from "@/types";
import { MAIN_SOURCE_ID, carryMarks, cutStarts, reverseWithin, withCopies, droppedPreviews, insertTiles, insertionPoint, isDirty, moveTiles, moveToPosition, nudgeTiles, replaceTiles, rotateBy, sameKeys, sameLabels, tilesAtParity, toggleCuts, useOrganizerStore, forgetOrganizerOf, withoutUnusedSources } from "./organizerStore";
import type { OrganizerSource } from "@/types";
import { useDocumentStore } from "@/shared/store/documentStore";

function page(index: number): OrganizerTile {
  return { key: `p${index}`, kind: "page", sourceId: "main", index, rotate: 0 };
}

const tiles = [page(1), page(2), page(3), page(4), page(5)];

describe("moveTiles", () => {
  it("moves a single tile before the drop index", () => {
    expect(moveTiles(tiles, new Set(["p5"]), 1).map((t) => t.key)).toEqual(["p1", "p5", "p2", "p3", "p4"]);
  });

  it("keeps the relative order of a multi-selection", () => {
    expect(moveTiles(tiles, new Set(["p1", "p3"]), 5).map((t) => t.key)).toEqual(["p2", "p4", "p5", "p1", "p3"]);
  });

  it("returns the same list when nothing moves so no empty undo step is recorded", () => {
    expect(moveTiles(tiles, new Set(["p2"]), 1)).toBe(tiles);
    expect(moveTiles(tiles, new Set(["p2"]), 4)).not.toBe(tiles);
  });

  it("is a no-op when dropping onto the same spot", () => {
    expect(moveTiles(tiles, new Set(["p2"]), 1).map((t) => t.key)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(moveTiles(tiles, new Set(["p2"]), 2).map((t) => t.key)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });
});

describe("nudgeTiles", () => {
  const keys = (list: OrganizerTile[]) => list.map((t) => t.key);

  it("moves the selection one step and keeps gaps between selected pages", () => {
    expect(keys(nudgeTiles(tiles, new Set(["p2"]), 1))).toEqual(["p1", "p3", "p2", "p4", "p5"]);
    expect(keys(nudgeTiles(tiles, new Set(["p2", "p4"]), -1))).toEqual(["p2", "p1", "p4", "p3", "p5"]);
  });

  it("moves a whole row and stops at the edge", () => {
    expect(keys(nudgeTiles(tiles, new Set(["p1", "p2"]), 3))).toEqual(["p3", "p4", "p5", "p1", "p2"]);
    expect(keys(nudgeTiles(tiles, new Set(["p4"]), 10))).toEqual(["p1", "p2", "p3", "p5", "p4"]);
  });

  it("returns the same list when nothing can move", () => {
    expect(nudgeTiles(tiles, new Set(["p1"]), -1)).toBe(tiles);
    expect(nudgeTiles(tiles, new Set(), 1)).toBe(tiles);
  });
});

describe("moveToPosition", () => {
  const keys = (list: OrganizerTile[]) => list.map((t) => t.key);

  it("puts the selected pages at the given page number", () => {
    expect(keys(moveToPosition(tiles, new Set(["p5"]), 1))).toEqual(["p5", "p1", "p2", "p3", "p4"]);
    expect(keys(moveToPosition(tiles, new Set(["p1", "p3"]), 3))).toEqual(["p2", "p4", "p1", "p3", "p5"]);
  });

  it("clamps positions past either end", () => {
    expect(keys(moveToPosition(tiles, new Set(["p2"]), 99))).toEqual(["p1", "p3", "p4", "p5", "p2"]);
    expect(keys(moveToPosition(tiles, new Set(["p2"]), -4))).toEqual(["p2", "p1", "p3", "p4", "p5"]);
  });

  it("returns the same list when the pages are already there or nothing is selected", () => {
    expect(moveToPosition(tiles, new Set(["p2"]), 2)).toBe(tiles);
    expect(moveToPosition(tiles, new Set(), 2)).toBe(tiles);
  });
});

describe("insertTiles / insertionPoint", () => {
  it("inserts after the last selected tile", () => {
    const at = insertionPoint(tiles, new Set(["p1", "p3"]));
    expect(at).toBe(3);
    const blank: OrganizerTile = { key: "b1", kind: "blank", width: 595, height: 842, rotate: 0 };
    expect(insertTiles(tiles, at, [blank]).map((t) => t.key)).toEqual(["p1", "p2", "p3", "b1", "p4", "p5"]);
  });

  it("appends when nothing is selected and clamps out-of-range positions", () => {
    expect(insertionPoint(tiles, new Set())).toBe(5);
    expect(insertTiles(tiles, 99, [page(6)]).map((t) => t.key).at(-1)).toBe("p6");
  });
});

describe("isDirty / rotateBy", () => {
  it("detects reorder, rotation and foreign pages", () => {
    expect(isDirty(tiles, tiles)).toBe(false);
    expect(isDirty([tiles[1], tiles[0], ...tiles.slice(2)], tiles)).toBe(true);
    expect(isDirty([{ ...tiles[0], rotate: 90 }, ...tiles.slice(1)], tiles)).toBe(true);
    expect(isDirty(tiles.slice(0, 4), tiles)).toBe(true);
  });

  it("wraps rotation both ways", () => {
    expect(rotateBy(270, 90)).toBe(0);
    expect(rotateBy(0, -90)).toBe(270);
  });
});

describe("isDirty / parity / replace", () => {
  it("sees a page swapped for the same page number of another document", () => {
    const swapped: OrganizerTile[] = [page(1), page(2), { key: "x3", kind: "page", sourceId: "other", index: 3, rotate: 0 }, page(4), page(5)];
    expect(isDirty(swapped, tiles)).toBe(true);
    expect(isDirty(tiles, tiles)).toBe(false);
  });

  it("picks odd and even positions, not page numbers", () => {
    const moved = [page(2), page(1), page(3)];
    expect(tilesAtParity(moved, "odd")).toEqual(["p2", "p3"]);
    expect(tilesAtParity(moved, "even")).toEqual(["p1"]);
  });

  it("puts replacement pages where the first replaced page stood", () => {
    const incoming: OrganizerTile[] = [
      { key: "n1", kind: "page", sourceId: "other", index: 1, rotate: 0 },
      { key: "n2", kind: "page", sourceId: "other", index: 2, rotate: 0 },
    ];
    expect(replaceTiles(tiles, new Set(["p2", "p4"]), incoming).map((tile) => tile.key)).toEqual(["p1", "n1", "n2", "p3", "p5"]);
    expect(replaceTiles(tiles, new Set(), incoming).map((tile) => tile.key)).toEqual(["p1", "p2", "p3", "p4", "p5", "n1", "n2"]);
  });
});

describe("cutStarts / toggleCuts", () => {
  it("turns marks after tiles into the positions where each part starts, following the current order", () => {
    expect(cutStarts(tiles, new Set(["p2", "p4"]))).toEqual([2, 4]);
    expect(cutStarts([tiles[3], tiles[0], tiles[1]], new Set(["p4"]))).toEqual([1]);
  });

  it("ignores a mark after the last tile or on a deleted tile", () => {
    expect(cutStarts(tiles, new Set(["p5", "gone"]))).toEqual([]);
  });

  it("adds marks unless every chosen tile is already marked, then removes them", () => {
    const added = toggleCuts(new Set(["p1"]), ["p1", "p3"]);
    expect([...added].sort()).toEqual(["p1", "p3"]);
    expect([...toggleCuts(added, ["p1", "p3"])]).toEqual([]);
    expect([...toggleCuts(added, [])].sort()).toEqual(["p1", "p3"]);
  });
});

describe("droppedPreviews", () => {
  const image = (url: string): OrganizerTile => ({ key: url, kind: "image", path: `${url}.png`, fileName: `${url}.png`, previewUrl: url, rotate: 0 });

  it("names a preview that no kept history still shows", () => {
    expect(droppedPreviews([[image("blob:a"), image("blob:b")]], [[image("blob:a")]])).toEqual(["blob:b"]);
  });

  it("keeps a preview another step still uses", () => {
    expect(droppedPreviews([[image("blob:a")]], [[page(1)], [image("blob:a")]])).toEqual([]);
  });

  it("ignores images without a preview", () => {
    expect(droppedPreviews([[image("")]], [])).toEqual([]);
  });
});

describe("withoutUnusedSources", () => {
  const source = (id: string): OrganizerSource => ({ id, path: `${id}.pdf`, password: null, fileName: `${id}.pdf`, embedDocId: null, pageCount: 1 });
  const sources = { main: source("main"), used: source("used"), loose: source("loose") };

  it("drops a document no tile ever took a page from", () => {
    const tile: OrganizerTile = { key: "u1", kind: "page", sourceId: "used", index: 1, rotate: 0 };
    expect(Object.keys(withoutUnusedSources(sources, [[page(1)], [tile]]))).toEqual(["main", "used"]);
  });

  it("never drops the open document", () => {
    expect(Object.keys(withoutUnusedSources({ main: source("main") }, []))).toEqual(["main"]);
  });

  it("returns the same object when nothing is unused", () => {
    const kept = { main: source("main") };
    expect(withoutUnusedSources(kept, [[page(1)]])).toBe(kept);
  });
});

describe("undo history of cuts and labels", () => {
  const store = () => useOrganizerStore.getState();

  beforeEach(() => {
    store().clear();
    store().initialize({ id: MAIN_SOURCE_ID, path: "C:/doc.pdf", password: null, fileName: "doc.pdf", embedDocId: "doc", pageCount: 4 });
  });

  it("undoes and redoes a cut like any page edit", () => {
    store().setMarks({ cuts: new Set(["p2"]) });
    expect([...store().cuts]).toEqual(["p2"]);
    store().undo();
    expect(store().cuts.size).toBe(0);
    store().redo();
    expect([...store().cuts]).toEqual(["p2"]);
  });

  it("undoes a label and restores the tiles and marks of each step together", () => {
    store().setMarks({ labels: { p1: { style: "r", prefix: "", firstNumber: 1 } } });
    store().commit([...store().tiles].reverse());
    store().undo();
    expect(store().tiles.map((tile) => tile.key)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(Object.keys(store().labels)).toEqual(["p1"]);
    store().undo();
    expect(store().labels).toEqual({});
  });

  it("records nothing when the marks do not change, and reset clears them", () => {
    store().setMarks({ cuts: new Set() });
    expect(store().past).toHaveLength(0);
    store().setMarks({ cuts: new Set(["p1"]) });
    store().reset();
    expect(store().cuts.size).toBe(0);
    store().undo();
    expect([...store().cuts]).toEqual(["p1"]);
  });
});

describe("sameKeys / sameLabels", () => {
  it("compares sets by content and labels by entry", () => {
    const label = { style: "D" as const, prefix: "", firstNumber: 1 };
    expect(sameKeys(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameKeys(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(sameLabels({ a: label }, { a: label })).toBe(true);
    expect(sameLabels({ a: label }, { b: label })).toBe(false);
  });
});

describe("carryMarks", () => {
  const roman = { style: "r" as const, prefix: "", firstNumber: 1 };

  it("hands a deleted page's label to the page that takes its place", () => {
    const after = [page(2), page(3), page(4), page(5)];

    const marks = carryMarks(tiles, after, { cuts: new Set(), labels: { p1: roman } });

    expect(marks.labels).toEqual({ p2: roman });
  });

  it("moves a split and a label from a replaced page to its replacement", () => {
    const replacement: OrganizerTile = { key: "new", kind: "blank", width: 595, height: 842, rotate: 0 };
    const after = [page(1), page(2), replacement, page(4), page(5)];

    const marks = carryMarks(tiles, after, { cuts: new Set(["p3"]), labels: { p3: roman } });

    expect([...marks.cuts]).toEqual(["new"]);
    expect(marks.labels).toEqual({ new: roman });
  });

  it("drops a split after the deleted last page and leaves untouched marks as they were", () => {
    const untouched = { cuts: new Set(["p1"]), labels: {} };
    expect(carryMarks(tiles, tiles.slice(0, 4), untouched)).toBe(untouched);

    const marks = carryMarks(tiles, tiles.slice(0, 4), { cuts: new Set(["p5"]), labels: { p4: roman, p5: roman } });

    expect(marks.cuts.size).toBe(0);
    expect(marks.labels).toEqual({ p4: roman });
  });
});

describe("organizer work per document", () => {
  const store = () => useOrganizerStore.getState();
  const main = (embedDocId: string, pageCount = 3) => ({ id: MAIN_SOURCE_ID, path: `C:/${embedDocId}.pdf`, password: null, fileName: `${embedDocId}.pdf`, embedDocId, pageCount });

  beforeEach(() => {
    store().clear();
    useDocumentStore.setState({ documents: { a: {}, b: {} } as never });
  });

  it("brings back the rearranged pages after switching to another document and back", () => {
    store().initialize(main("a"));
    store().commit([...store().tiles].reverse(), { cuts: new Set(["p2"]) });

    store().initialize(main("b"));
    expect(store().tiles.map((tile) => tile.key)).toEqual(["p1", "p2", "p3"]);
    store().initialize(main("a"));

    expect(store().tiles.map((tile) => tile.key)).toEqual(["p3", "p2", "p1"]);
    expect([...store().cuts]).toEqual(["p2"]);
    expect(store().past).toHaveLength(1);
  });

  it("starts fresh when the document now has a different page count", () => {
    store().initialize(main("a"));
    store().commit([...store().tiles].reverse());
    store().initialize(main("b"));

    store().initialize(main("a", 5));

    expect(store().tiles).toHaveLength(5);
    expect(store().past).toHaveLength(0);
  });

  it("forgets a document's work once it is closed", () => {
    store().initialize(main("a"));
    store().commit([...store().tiles].reverse());
    store().initialize(main("b"));

    forgetOrganizerOf("a");
    store().initialize(main("a"));

    expect(store().tiles.map((tile) => tile.key)).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps no work for a document that was already closed, as after an in-place reload", () => {
    store().initialize(main("a"));
    store().commit([...store().tiles].reverse());
    useDocumentStore.setState({ documents: { b: {} } as never });

    store().initialize(main("b"));
    useDocumentStore.setState({ documents: { a: {}, b: {} } as never });
    store().initialize(main("a"));

    expect(store().tiles.map((tile) => tile.key)).toEqual(["p1", "p2", "p3"]);
    expect(store().past).toHaveLength(0);
  });
});

describe("selection edits", () => {
  const keys = (list: OrganizerTile[]) => list.map((tile) => tile.key);

  it("reverses only the selected pages in their own places", () => {
    expect(keys(reverseWithin(tiles, new Set(["p1", "p3", "p5"])))).toEqual(["p5", "p2", "p3", "p4", "p1"]);
    expect(reverseWithin(tiles, new Set(["p2"]))).toBe(tiles);
  });

  it("puts copies right after each page or as a block after the selection", () => {
    let counter = 0;
    const makeKey = () => `c${++counter}`;

    const each = withCopies(tiles, new Set(["p2", "p4"]), 2, "each", makeKey);
    const block = withCopies(tiles, new Set(["p2", "p4"]), 2, "block", makeKey);

    expect(keys(each.tiles)).toEqual(["p1", "p2", "c1", "c2", "p3", "p4", "c3", "c4", "p5"]);
    expect(each.copies).toEqual(["c1", "c2", "c3", "c4"]);
    expect(keys(block.tiles)).toEqual(["p1", "p2", "p3", "p4", "c5", "c6", "c7", "c8", "p5"]);
    expect(block.tiles[4]).toMatchObject({ index: 2 });
    expect(block.tiles[5]).toMatchObject({ index: 4 });
  });

  it("makes no copies without a selection and inserts before, after or at the end", () => {
    expect(withCopies(tiles, new Set(), 3, "each", () => "x").copies).toEqual([]);
    const selected = new Set(["p2", "p3"]);

    expect(insertionPoint(tiles, selected, "before")).toBe(1);
    expect(insertionPoint(tiles, selected, "after")).toBe(3);
    expect(insertionPoint(tiles, selected, "end")).toBe(5);
    expect(insertionPoint(tiles, new Set(), "before")).toBe(5);
  });
});
