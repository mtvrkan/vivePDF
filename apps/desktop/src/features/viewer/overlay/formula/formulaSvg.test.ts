import { describe, expect, it } from "vitest";
import { clampFormulaSize, coloredFormulaSvg, formulaBox, formulaDataUrl, formulaSizeOf } from "./formulaSvg";

const SAMPLE = '<svg style="vertical-align: -0.025ex;" xmlns="http://www.w3.org/2000/svg" width="8.704ex" height="2.025ex" viewBox="0 -883.9 3847.1 894.9"><g stroke="currentColor" fill="currentColor" stroke-width="0"><path d="M1 2"/><rect width="10" height="2"/></g></svg>';

describe("coloredFormulaSvg", () => {
  it("paints the formula and drops the size given in ex while keeping inner sizes", () => {
    const result = coloredFormulaSvg(SAMPLE, "#1d4ed8");
    expect(result).not.toContain("currentColor");
    expect(result).toContain('fill="#1d4ed8"');
    expect(result.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox=')).toBe(true);
    expect(result).toContain('<rect width="10" height="2"/>');
  });

  it("falls back to near-black for anything that is not a hex colour", () => {
    expect(coloredFormulaSvg(SAMPLE, 'red" onload="x')).toContain('fill="#111111"');
  });
});

describe("formulaDataUrl", () => {
  it("gives the picture a size in proportion to the formula", () => {
    const url = formulaDataUrl({ svg: SAMPLE, color: "#111111", emWidth: 3.8471, emHeight: 0.8949 });
    const decoded = decodeURIComponent(url.replace("data:image/svg+xml;charset=utf-8,", ""));
    expect(decoded.startsWith('<svg width="384.71" height="89.49" xmlns=')).toBe(true);
  });
});

describe("formula size", () => {
  it("turns a type size into a box and back", () => {
    const source = { emWidth: 4, emHeight: 1.5 };
    expect(formulaBox(source, 20)).toEqual({ width: 80, height: 30 });
    expect(formulaSizeOf(source, 80)).toBe(20);
  });

  it("keeps sizes within the supported range", () => {
    expect(clampFormulaSize(2)).toBe(6);
    expect(clampFormulaSize(500)).toBe(144);
    expect(clampFormulaSize(Number.NaN)).toBe(18);
    expect(formulaSizeOf({ emWidth: 0 }, 50)).toBe(18);
  });
});
