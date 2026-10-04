import { describe, expect, it } from "vitest";
import { createImage, normalizeElement } from "./design";
import { applyMatrix, FILTER_PRESETS, filterMatrix, NEUTRAL_FILTERS, normalizeFilters, presetOf, svgColorMatrix } from "./imageFilters";
import { elementItems } from "./render";

describe("image filters", () => {
  it("builds the CSS filter-effects matrices for each adjustment", () => {
    const brighter = filterMatrix({ ...NEUTRAL_FILTERS, brightness: 1.5 });
    const contrast = filterMatrix({ ...NEUTRAL_FILTERS, contrast: 2 });
    const grey = filterMatrix({ ...NEUTRAL_FILTERS, grayscale: 1 });

    expect(brighter).toEqual([1.5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1.5, 0]);
    expect(contrast).toEqual([2, 0, 0, -0.5, 0, 2, 0, -0.5, 0, 0, 2, -0.5]);
    expect(grey?.slice(0, 4)).toEqual([0.2126, 0.7152, 0.0722, 0]);
    expect(applyMatrix(grey ?? [], [1, 0, 0])[0]).toBeCloseTo(0.2126);
  });

  it("composes adjustments in order and clamps the result to the colour range", () => {
    const matrix = filterMatrix({ ...NEUTRAL_FILTERS, brightness: 2, contrast: 0.5 }) ?? [];

    expect(applyMatrix(matrix, [0.25, 0.5, 1])).toEqual([0.5, 0.75, 1]);
    expect(applyMatrix(filterMatrix({ ...NEUTRAL_FILTERS, brightness: 2 }) ?? [], [0.8, 0.8, 0.8])).toEqual([1, 1, 1]);
  });

  it("returns no matrix for neutral or missing filters", () => {
    expect(filterMatrix(NEUTRAL_FILTERS)).toBeNull();
    expect(filterMatrix(undefined)).toBeNull();
  });

  it("normalises unknown, out-of-range and neutral values", () => {
    expect(normalizeFilters({ brightness: 9, warmth: -4, sepia: "x" })).toEqual({ ...NEUTRAL_FILTERS, brightness: 2, warmth: -1 });
    expect(normalizeFilters({ brightness: 1 })).toBeUndefined();
    expect(normalizeFilters(null)).toBeUndefined();
    expect(normalizeFilters([1, 2])).toBeUndefined();
  });

  it("keeps filters on image elements and sends the matrix to the renderer", () => {
    const image = { ...createImage("a.png", 0, 0, 10, 10), filters: FILTER_PRESETS.vivid };

    const normalised = normalizeElement(image);
    const plain = normalizeElement(createImage("a.png", 0, 0, 10, 10));

    expect(normalised).toMatchObject({ filters: FILTER_PRESETS.vivid });
    expect(plain).not.toHaveProperty("filters");
    expect(elementItems(image)[0]).toMatchObject({ filter: filterMatrix(FILTER_PRESETS.vivid) });
    expect(elementItems(createImage("a.png", 0, 0, 10, 10))[0]).not.toHaveProperty("filter");
  });

  it("recognises presets and writes an SVG colour matrix", () => {
    expect(presetOf(FILTER_PRESETS.bw)).toBe("bw");
    expect(presetOf(undefined)).toBe("none");
    expect(presetOf({ ...NEUTRAL_FILTERS, brightness: 1.01 })).toBeNull();
    expect(svgColorMatrix([1, 0, 0, 0.5, 0, 1, 0, 0, 0, 0, 1, 0]).split(" ")).toHaveLength(20);
    expect(svgColorMatrix([1, 0, 0, 0.5, 0, 1, 0, 0, 0, 0, 1, 0]).startsWith("1 0 0 0 0.5")).toBe(true);
  });
});
