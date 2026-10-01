import { describe, expect, it } from "vitest";
import { isUsableArea, looksLikeCode, normalizeArea, screenRectFor } from "./areaText";

describe("normalizeArea", () => {
  it("orders the corners whichever way the drag went", () => {
    expect(normalizeArea({ x0: 90, y0: 70, x1: 10, y1: 20 })).toEqual({ x0: 10, y0: 20, x1: 90, y1: 70 });
  });
});

describe("isUsableArea", () => {
  it("rejects a stray click and a hairline drag", () => {
    expect(isUsableArea({ x0: 10, y0: 10, x1: 10, y1: 10 })).toBe(false);
    expect(isUsableArea({ x0: 10, y0: 10, x1: 200, y1: 12 })).toBe(false);
  });

  it("accepts a real rectangle either way round", () => {
    expect(isUsableArea({ x0: 10, y0: 10, x1: 200, y1: 60 })).toBe(true);
    expect(isUsableArea({ x0: 200, y0: 60, x1: 10, y1: 10 })).toBe(true);
  });
});

describe("screenRectFor", () => {
  it("places the page area on screen at the current zoom", () => {
    const anchor = { left: 100, top: 50, width: 800, height: 1000 };
    expect(screenRectFor(anchor, 2, { x0: 10, y0: 20, x1: 60, y1: 40 })).toEqual({ left: 120, top: 90, width: 100, height: 40 });
  });

  it("follows the page when the view is turned a quarter", () => {
    const anchor = { left: 100, top: 50, width: 1000, height: 800 };
    expect(screenRectFor(anchor, 2, { x0: 10, y0: 20, x1: 60, y1: 40 }, 1)).toEqual({ left: 1020, top: 70, width: 40, height: 100 });
  });

  it("follows the page when the view is turned upside down", () => {
    const anchor = { left: 100, top: 50, width: 800, height: 1000 };
    expect(screenRectFor(anchor, 2, { x0: 10, y0: 20, x1: 60, y1: 40 }, 2)).toEqual({ left: 780, top: 970, width: 100, height: 40 });
  });
});

describe("looksLikeCode", () => {
  const line = (text: string, x0 = 10) => ({ text, x0, x1: x0 + text.length * 5 });

  it("is false for prose", () => {
    expect(looksLikeCode([line("Dil nedir?"), line("Diller nasil dogar")])).toBe(false);
  });

  it("is true when several lines carry code punctuation or keywords", () => {
    expect(looksLikeCode([line("def main():"), line("    return 1"), line("main()")])).toBe(true);
  });

  it("needs more than a couple of lines", () => {
    expect(looksLikeCode([line("return 1;")])).toBe(false);
  });
});
