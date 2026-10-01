import { beforeEach, describe, expect, it } from "vitest";
import type { OrganizerTile } from "@/types";
import { MAIN_SOURCE_ID, cutStarts, droppedPreviews, insertTiles, insertionPoint, isDirty, moveTiles, moveToPosition, nudgeTiles, replaceTiles, rotateBy, sameKeys, sameLabels, tilesAtParity, toggleCuts, useOrganizerStore, withoutUnusedSources } from "./organizerStore";
import type { OrganizerSource } from "@/types";

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
