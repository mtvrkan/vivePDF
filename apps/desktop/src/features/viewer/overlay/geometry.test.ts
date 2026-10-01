import { describe, expect, it } from "vitest";
import { applyGeometryPatch, formatGeometryValue, parseGeometryValue } from "./geometry";

describe("parseGeometryValue", () => {
  it("parses a decimal value rounded to one decimal", () => {
    expect(parseGeometryValue("12.34")).toBe(12.3);
  });

  it("accepts a comma decimal separator", () => {
    expect(parseGeometryValue("7,5")).toBe(7.5);
  });

  it("returns null for empty or non-numeric input", () => {
    expect(parseGeometryValue("")).toBeNull();
    expect(parseGeometryValue("abc")).toBeNull();
  });
});

describe("formatGeometryValue", () => {
  it("formats to one decimal place", () => {
    expect(formatGeometryValue(12)).toBe("12.0");
    expect(formatGeometryValue(12.345)).toBe("12.3");
  });
});

describe("applyGeometryPatch", () => {
  const rect = { x: 10, y: 20, width: 100, height: 50 };

  it("updates x directly without touching other fields", () => {
    expect(applyGeometryPatch(rect, "x", 40, false, 2)).toEqual({ x: 40 });
  });

  it("scales height to preserve aspect when width changes and aspect is locked", () => {
    expect(applyGeometryPatch(rect, "width", 200, true, 2)).toEqual({ width: 200, height: 100 });
  });

  it("clamps width/height to a minimum of 1", () => {
    expect(applyGeometryPatch(rect, "width", -5, false, 2)).toEqual({ width: 1 });
  });
});
