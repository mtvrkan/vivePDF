import { describe, expect, it } from "vitest";
import { hexToHsv, hexToRgb, hsvToHex, isLightColor, isValidHex, normalizeHex, rgbToHex } from "./color";

describe("hex parsing", () => {
  it("expands short hex and adds the missing hash", () => {
    expect(normalizeHex("f0a")).toBe("#ff00aa");
    expect(normalizeHex("#ABCDEF")).toBe("#abcdef");
  });

  it("falls back for invalid input", () => {
    expect(normalizeHex("nope")).toBe("#000000");
    expect(normalizeHex("#12345", "#ffffff")).toBe("#ffffff");
    expect(isValidHex("#abc")).toBe(true);
    expect(isValidHex("#abcd")).toBe(false);
  });
});

describe("conversions", () => {
  it("round-trips primary colours through hsv", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#000000", "#e5484d", "#3e63dd"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("maps rgb and hex both ways", () => {
    expect(hexToRgb("#e5484d")).toEqual({ r: 229, g: 72, b: 77 });
    expect(rgbToHex({ r: 229, g: 72, b: 77 })).toBe("#e5484d");
    expect(rgbToHex({ r: -20, g: 300, b: 12.6 })).toBe("#00ff0d");
  });

  it("reads hue, saturation and value", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#008000").h).toBe(120);
    expect(hexToHsv("#000000").s).toBe(0);
  });

  it("separates light from dark colours", () => {
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#f5b400")).toBe(true);
    expect(isLightColor("#111111")).toBe(false);
    expect(isLightColor("#3e63dd")).toBe(false);
  });
});
