import { describe, expect, it } from "vitest";
import type { PageDiff } from "@/types";
import { alignedRows, alignmentFrom, changePosition, nextChange } from "./pageAlignment";

const diff = (page: number, pageA: number | null, pageB: number | null): PageDiff => ({
  page,
  pageA,
  pageB,
  inA: pageA !== null,
  inB: pageB !== null,
  addedWords: 0,
  removedWords: 0,
  changedArea: 0,
  sizeChanged: false,
  snippets: [],
  marksA: [],
  marksB: [],
});

const inserted = [diff(1, 1, 1), diff(2, null, 2), diff(3, 2, 3), diff(4, 3, null), diff(5, 4, 4)];

describe("page alignment", () => {
  it("pairs pages one to one when there is no comparison yet", () => {
    expect(alignedRows(null, 3, 2)).toEqual([
      { row: 1, a: 1, b: 1 },
      { row: 2, a: 2, b: 2 },
      { row: 3, a: 3, b: null },
    ]);
    const alignment = alignmentFrom(null, 3, 2);
    expect(alignment.toB(2)).toBe(2);
    expect(alignment.toB(3)).toBe(2);
  });

  it("follows the compared alignment across inserted and removed pages", () => {
    const alignment = alignmentFrom(inserted, 4, 4);
    expect(alignment.toB(2)).toBe(3);
    expect(alignment.toB(4)).toBe(4);
    expect(alignment.toA(2)).toBe(1);
    expect(alignment.toA(3)).toBe(2);
    expect(alignment.rowOfA(3)).toBe(4);
    expect(alignment.rowOfB(2)).toBe(2);
  });

  it("maps a page that is only in one file to the nearest page of the other", () => {
    const alignment = alignmentFrom(inserted, 4, 4);
    expect(alignment.toB(3)).toBe(3);
    expect(alignment.toB(99)).toBeNull();
  });
});

describe("change navigation", () => {
  const changes = [{ row: 2 }, { row: 4 }, { row: 9 }];

  it("finds the next and the previous change from the current row", () => {
    expect(nextChange(changes, 2, 1)).toEqual({ row: 4 });
    expect(nextChange(changes, 5, -1)).toEqual({ row: 4 });
    expect(nextChange(changes, 1, 1)).toEqual({ row: 2 });
  });

  it("stops at both ends", () => {
    expect(nextChange(changes, 9, 1)).toBeNull();
    expect(nextChange(changes, 2, -1)).toBeNull();
    expect(nextChange([], 1, 1)).toBeNull();
  });

  it("numbers the change on the current row", () => {
    expect(changePosition(changes, 4)).toBe(2);
    expect(changePosition(changes, 3)).toBe(0);
  });
});
