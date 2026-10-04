import { describe, expect, it } from "vitest";
import type { OrganizerTile } from "@/types";
import { bookmarkCuts, duplexOrder, duplicateTiles, formatLabel, imageGroupKey, labelRules, positionsToKeys, restoredCuts, restoredLabels, tileLabelTexts, topLevelStarts } from "./organizerTools";

function page(index: number, sourceId = "main", key = `${sourceId}-${index}`): OrganizerTile {
  return { key, kind: "page", sourceId, index, rotate: 0 };
}

function pages(count: number): OrganizerTile[] {
  return Array.from({ length: count }, (_, index) => page(index + 1));
}

const blank: OrganizerTile = { key: "blank", kind: "blank", width: 595, height: 842, rotate: 0 };

describe("topLevelStarts", () => {
  it("keeps only the outermost chapters and skips one on the first page", () => {
    const items = [
      { level: 1, page: 1 },
      { level: 2, page: 2 },
      { level: 1, page: 4 },
      { level: 1, page: 0 },
    ];
    expect([...topLevelStarts(items)]).toEqual([4]);
  });

  it("is empty when the document has no bookmarks", () => {
    expect(topLevelStarts([]).size).toBe(0);
  });
});

describe("bookmarkCuts", () => {
  it("cuts before each chapter start, wherever the page was moved", () => {
    const tiles = [page(1), page(3), page(2), page(4)];
    expect(bookmarkCuts(tiles, { main: new Set([3, 4]) })).toEqual(["main-1", "main-2"]);
  });

  it("never cuts before the first tile or for another document", () => {
    const tiles = [page(3), page(3, "other"), page(1)];
    expect(bookmarkCuts(tiles, { main: new Set([3]) })).toEqual([]);
  });
});

describe("duplicateTiles", () => {
  it("marks every later copy of the same content and keeps the first", () => {
    const tiles = [page(1), page(2), page(1, "main", "copy"), page(1, "other")];
    const groups = { main: [0, 1], other: [1] };
    expect(duplicateTiles(tiles, groups)).toEqual(["copy", "other-1"]);
  });

  it("never marks blank pages as copies of each other", () => {
    const tiles = [page(1), page(2), blank, { ...blank, key: "blank-2" }];
    expect(duplicateTiles(tiles, { main: [null, null] })).toEqual([]);
  });

  it("marks the same picture inserted twice", () => {
    const image = (key: string): OrganizerTile => ({ key, kind: "image", path: "C:/a.png", fileName: "a.png", previewUrl: "", rotate: 0 });
    expect(duplicateTiles([image("one"), image("two")], {})).toEqual(["two"]);
  });

  it("marks a picture that shows the same content as a page", () => {
    const picture: OrganizerTile = { key: "picture", kind: "image", path: "C:/scan.png", fileName: "scan.png", previewUrl: "", rotate: 0 };
    expect(duplicateTiles([page(1), page(2), picture], { main: [3, null], [imageGroupKey("C:/scan.png")]: [3] })).toEqual(["picture"]);
  });

  it("keeps pages the engine left ungrouped", () => {
    expect(duplicateTiles([page(1), page(2), page(3)], { main: [null, null, null] })).toEqual([]);
  });
});

describe("duplexOrder", () => {
  const keys = () => "pad";

  it("puts the fronts first and the backs reversed, with a cut between them", () => {
    const result = duplexOrder(pages(4), { padding: null, reverseBacks: true }, keys);
    expect(result.tiles.map((tile) => tile.key)).toEqual(["main-1", "main-3", "main-4", "main-2"]);
    expect(result.cutAfter).toBe("main-3");
  });

  it("pads an odd count with a blank page so the last front gets a back", () => {
    const result = duplexOrder(pages(3), { padding: { width: 595, height: 842 }, reverseBacks: true }, keys);
    expect(result.tiles.map((tile) => tile.key)).toEqual(["main-1", "main-3", "pad", "main-2"]);
    expect(result.tiles[2]).toMatchObject({ kind: "blank", width: 595, height: 842 });
  });

  it("keeps the backs in order and leaves one page alone", () => {
    expect(duplexOrder(pages(4), { padding: null, reverseBacks: false }, keys).tiles.map((tile) => tile.key)).toEqual(["main-1", "main-3", "main-2", "main-4"]);
    expect(duplexOrder(pages(1), { padding: null, reverseBacks: true }, keys)).toEqual({ tiles: pages(1), cutAfter: null });
  });
});

describe("page labels", () => {
  const labels = {
    "main-1": { style: "" as const, prefix: "Kapak", firstNumber: 1 },
    "main-2": { style: "r" as const, prefix: "", firstNumber: 1 },
    "main-4": { style: "D" as const, prefix: "", firstNumber: 1 },
  };

  it("shows a cover, roman front matter and arabic body", () => {
    expect(tileLabelTexts(pages(5), labels)).toEqual(["Kapak", "i", "ii", "1", "2"]);
  });

  it("sends a rule for each labelled tile at its current position", () => {
    const tiles = [page(2), page(1), page(3), page(4)];
    expect(labelRules(tiles, labels).map((rule) => [rule.start, rule.style])).toEqual([
      [0, "r"],
      [1, ""],
      [3, "D"],
    ]);
  });

  it("ignores the labels of tiles that were deleted", () => {
    expect(tileLabelTexts([page(3)], labels)).toBeNull();
    expect(labelRules([page(3)], labels)).toEqual([]);
  });

  it("formats roman numerals, letters and prefixes", () => {
    expect(formatLabel({ style: "R", prefix: "", firstNumber: 1 }, 13)).toBe("XIV");
    expect(formatLabel({ style: "a", prefix: "", firstNumber: 27 }, 0)).toBe("aa");
    expect(formatLabel({ style: "D", prefix: "A-", firstNumber: 5 }, 1)).toBe("A-6");
  });
});

describe("positionsToKeys", () => {
  it("maps page positions to tiles once each and skips positions past the end", () => {
    expect(positionsToKeys(pages(3), [3, 1, 3, 9])).toEqual(["main-3", "main-1"]);
  });
});

describe("restoredLabels / restoredCuts", () => {
  const keys = new Set(["p1", "p2"]);

  it("keeps valid entries for pages that still exist", () => {
    expect(restoredLabels({ p1: { style: "r", prefix: "A-", firstNumber: 3 } }, keys)).toEqual({ p1: { style: "r", prefix: "A-", firstNumber: 3 } });
    expect([...restoredCuts(["p2", "p1"], keys)]).toEqual(["p2", "p1"]);
  });

  it("drops unknown pages and malformed or out-of-range values", () => {
    const stored = {
      gone: { style: "D", prefix: "", firstNumber: 1 },
      p1: { style: "X", prefix: "", firstNumber: 1 },
      p2: { style: "D", prefix: "x".repeat(65), firstNumber: 1 },
    };
    expect(restoredLabels(stored, keys)).toEqual({});
    expect(restoredLabels({ p1: { style: "D", prefix: "", firstNumber: 0 } }, keys)).toEqual({});
    expect([...restoredCuts(["gone", 4, "p1"], keys)]).toEqual(["p1"]);
  });

  it("returns nothing for a missing or wrongly shaped snapshot", () => {
    expect(restoredLabels(undefined, keys)).toEqual({});
    expect(restoredLabels("p1", keys)).toEqual({});
    expect(restoredCuts({ p1: true }, keys).size).toBe(0);
  });
});
