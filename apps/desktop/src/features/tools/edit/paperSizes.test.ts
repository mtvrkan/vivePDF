import { describe, expect, it } from "vitest";
import { paperChange, paperName, paperScale } from "./paperSizes";

const A4 = { width: 595, height: 842 };

describe("paperScale", () => {
  it("halves the sides from A4 to A6 and grows them by the square root of two to A3", () => {
    expect(paperScale(A4, "a6", true)).toBeCloseTo(0.5, 2);
    expect(paperScale(A4, "a5", true)).toBeCloseTo(0.707, 2);
    expect(paperScale(A4, "a3", true)).toBeCloseTo(1.414, 2);
    expect(paperScale(A4, "a4", true)).toBeCloseTo(1, 2);
  });

  it("turns the target for a landscape page only when asked", () => {
    const landscape = { width: 842, height: 595 };

    expect(paperScale(landscape, "a5", true)).toBeCloseTo(0.707, 2);
    expect(paperScale(landscape, "a5", false)).toBeCloseTo(0.5, 2);
  });
});

describe("paperChange", () => {
  it("names a shrink, an enlargement and a size within two percent as the same", () => {
    expect(paperChange(0.71)).toBe("shrink");
    expect(paperChange(1.41)).toBe("enlarge");
    expect(paperChange(1.015)).toBe("same");
    expect(paperName("a5")).toBe("A5");
    expect(paperName("letter")).toBe("Letter");
  });
});
