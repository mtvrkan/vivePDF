import { describe, expect, it } from "vitest";
import { pagesToRanges, rangePages, scopePages } from "./pageScope";

describe("scopePages", () => {
  it("lists all, odd, even and every n-th page", () => {
    expect(scopePages({ kind: "all" }, 4)).toEqual([1, 2, 3, 4]);
    expect(scopePages({ kind: "odd" }, 5)).toEqual([1, 3, 5]);
    expect(scopePages({ kind: "even" }, 5)).toEqual([2, 4]);
    expect(scopePages({ kind: "every", every: 3, start: 2 }, 9)).toEqual([2, 5, 8]);
  });

  it("returns no pages when the start is past the end and null for impossible steps", () => {
    expect(scopePages({ kind: "every", every: 2, start: 9 }, 4)).toEqual([]);
    expect(scopePages({ kind: "every", every: 0, start: 1 }, 4)).toBeNull();
    expect(scopePages({ kind: "odd" }, 0)).toEqual([]);
  });

  it("reads ranges and rejects bad ones", () => {
    expect(scopePages({ kind: "ranges", ranges: "3-, 1, 3" }, 4)).toEqual([3, 4, 1]);
    expect(scopePages({ kind: "ranges", ranges: "" }, 4)).toBeNull();
    expect(scopePages({ kind: "ranges", ranges: "2-9" }, 4)).toBeNull();
  });
});

describe("rangePages", () => {
  it("counts backwards ranges and drops repeats", () => {
    expect(rangePages("4-2, 3", 5)).toEqual([4, 3, 2]);
  });

  it("refuses text and page zero", () => {
    expect(rangePages("a", 5)).toBeNull();
    expect(rangePages("0-2", 5)).toBeNull();
  });
});

describe("pagesToRanges", () => {
  it("joins runs into ranges and keeps single pages alone", () => {
    expect(pagesToRanges([1, 2, 3, 5, 7, 8])).toBe("1-3, 5, 7-8");
  });

  it("returns an empty text for no pages", () => {
    expect(pagesToRanges([])).toBe("");
  });

  it("round-trips through rangePages", () => {
    expect(rangePages(pagesToRanges([2, 3, 4, 9]), 10)).toEqual([2, 3, 4, 9]);
  });
});
