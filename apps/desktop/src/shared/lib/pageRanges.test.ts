import { describe, expect, it } from "vitest";
import { pagesInRanges } from "./pageRanges";

describe("pagesInRanges", () => {
  it("takes every page when nothing is asked for", () => {
    expect(pagesInRanges("", 12)).toBe(12);
    expect(pagesInRanges("   ", 12)).toBe(12);
    expect(pagesInRanges("all", 12)).toBe(12);
  });

  it("counts a range", () => {
    expect(pagesInRanges("2-5", 12)).toBe(4);
  });

  it("counts several ranges together", () => {
    expect(pagesInRanges("1-3, 7, 9-10", 12)).toBe(6);
  });

  it("reads an open end as the rest of the document", () => {
    expect(pagesInRanges("9-", 12)).toBe(4);
  });

  it("counts a page named twice twice, as the merge copies it twice", () => {
    expect(pagesInRanges("1-4, 3", 12)).toBe(5);
  });

  it("accepts a range written backwards", () => {
    expect(pagesInRanges("5-2", 12)).toBe(4);
  });

  it("refuses what the engine refuses", () => {
    expect(pagesInRanges("1-99", 12)).toBeNull();
    expect(pagesInRanges("abc", 12)).toBeNull();
    expect(pagesInRanges("0", 12)).toBeNull();
    expect(pagesInRanges("1-3,", 12)).toBeNull();
    expect(pagesInRanges("1,,2", 12)).toBeNull();
  });
});
