import { describe, expect, it } from "vitest";
import { wholeWithin, withinRange } from "./numberRange";

const RANGE = { min: 4, max: 72 };

describe("withinRange", () => {
  it("accepts both ends of the range", () => {
    expect(withinRange(4, RANGE)).toBe(true);
    expect(withinRange(72, RANGE)).toBe(true);
    expect(withinRange(10.5, RANGE)).toBe(true);
  });

  it("rejects values outside the range", () => {
    expect(withinRange(3.9, RANGE)).toBe(false);
    expect(withinRange(73, RANGE)).toBe(false);
  });

  it("rejects an empty number input", () => {
    expect(withinRange(Number.NaN, RANGE)).toBe(false);
    expect(withinRange(Number.POSITIVE_INFINITY, { min: 0, max: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe("wholeWithin", () => {
  it("accepts whole numbers only", () => {
    expect(wholeWithin(12, RANGE)).toBe(true);
    expect(wholeWithin(12.5, RANGE)).toBe(false);
    expect(wholeWithin(Number.NaN, RANGE)).toBe(false);
  });
});
