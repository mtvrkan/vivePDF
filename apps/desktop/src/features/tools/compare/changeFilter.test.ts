import { describe, expect, it } from "vitest";
import { areaPercent, filterCounts, isChanged, matchesFilter, pageLabel } from "./changeFilter";
import type { PageDiff } from "@/types";

const page = (overrides: Partial<PageDiff>): PageDiff => ({
  page: 1,
  pageA: 1,
  pageB: 1,
  inA: true,
  inB: true,
  addedWords: 0,
  removedWords: 0,
  changedArea: 0,
  sizeChanged: false,
  snippets: [],
  marksA: [],
  marksB: [],
  ...overrides,
});

describe("changeFilter", () => {
  const same = page({});
  const worded = page({ page: 2, addedWords: 3 });
  const drawn = page({ page: 3, changedArea: 0.05 });
  const inserted = page({ page: 4, pageA: null, inA: false, changedArea: 1 });
  const noise = page({ page: 5, changedArea: 0.001 });

  it("treats a page with nothing but rendering noise as unchanged", () => {
    expect(isChanged(same)).toBe(false);
    expect(isChanged(noise)).toBe(false);
  });

  it("keeps each change type under its own filter", () => {
    expect(matchesFilter(worded, "text")).toBe(true);
    expect(matchesFilter(worded, "visual")).toBe(false);
    expect(matchesFilter(drawn, "visual")).toBe(true);
    expect(matchesFilter(drawn, "text")).toBe(false);
    expect(matchesFilter(inserted, "pages")).toBe(true);
    expect(matchesFilter(worded, "pages")).toBe(false);
  });

  it("counts every changed page once under all", () => {
    expect(filterCounts([same, worded, drawn, inserted, noise])).toEqual({ all: 3, text: 1, visual: 2, pages: 1 });
  });

  it("treats a page size change as a visual change", () => {
    const resized = page({ page: 6, sizeChanged: true });
    expect(isChanged(resized)).toBe(true);
    expect(matchesFilter(resized, "visual")).toBe(true);
    expect(matchesFilter(resized, "text")).toBe(false);
  });
});

describe("pageLabel", () => {
  it("names both sides when the matched pages differ", () => {
    expect(pageLabel(2, 2)).toBe("p2");
    expect(pageLabel(2, 3)).toBe("A2 · B3");
    expect(pageLabel(null, 4)).toBe("B4");
    expect(pageLabel(5, null)).toBe("A5");
  });
});

describe("areaPercent", () => {
  it("never shows a real change as zero percent", () => {
    expect(areaPercent(0.004)).toBe("<1%");
    expect(areaPercent(0.126)).toBe("13%");
    expect(areaPercent(1)).toBe("100%");
  });
});
