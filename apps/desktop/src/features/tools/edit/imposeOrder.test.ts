import { describe, expect, it } from "vitest";
import { cellOrder, gridOf, hasSpine, slotLabels } from "./imposeOrder";

describe("hasSpine", () => {
  it("puts a spine only between two equal halves", () => {
    expect(hasSpine(2)).toBe(true);
    expect(hasSpine(4)).toBe(true);
    expect(hasSpine(1)).toBe(false);
    expect(hasSpine(3)).toBe(false);
  });
});

describe("gridOf", () => {
  it("maps each named layout to its grid", () => {
    expect(gridOf("2up", 1, 1)).toEqual([2, 1]);
    expect(gridOf("6up", 1, 1)).toEqual([3, 2]);
    expect(gridOf("16up", 1, 1)).toEqual([4, 4]);
    expect(gridOf("booklet", 1, 1)).toEqual([2, 1]);
  });

  it("takes the custom grid from the settings and clamps it", () => {
    expect(gridOf("custom", 3, 5)).toEqual([3, 5]);
    expect(gridOf("custom", 0, 40)).toEqual([1, 12]);
  });
});

describe("cellOrder", () => {
  it("fills rows left to right", () => {
    expect(cellOrder(3, 2, "rows", "ltr")).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("mirrors each row when reading right to left", () => {
    expect(cellOrder(3, 2, "rows", "rtl")).toEqual([2, 1, 0, 5, 4, 3]);
  });

  it("fills columns downward", () => {
    expect(cellOrder(3, 2, "columns", "ltr")).toEqual([0, 3, 1, 4, 2, 5]);
  });

  it("starts at the right column when reading right to left", () => {
    expect(cellOrder(3, 2, "columns", "rtl")).toEqual([2, 5, 1, 4, 0, 3]);
  });
});

describe("slotLabels", () => {
  it("numbers the cells in the order pages land in them", () => {
    expect(slotLabels(2, 2, "rows", "ltr")).toEqual([1, 2, 3, 4]);
    expect(slotLabels(2, 2, "columns", "ltr")).toEqual([1, 3, 2, 4]);
    expect(slotLabels(2, 2, "rows", "rtl")).toEqual([2, 1, 4, 3]);
  });
});
