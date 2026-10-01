import { describe, expect, it } from "vitest";
import { DUOTONE_SCHEMES, duotoneTables, isPageColorScheme, pageColorFilterId, pageColorStyle } from "./pageColors";

describe("pageColorStyle", () => {
  it("leaves normal pages alone and keeps the previous dark inversion", () => {
    expect(pageColorStyle("normal")).toBeUndefined();
    expect(pageColorStyle("dark")).toEqual({ filter: "invert(0.92) hue-rotate(180deg)" });
  });

  it("points every other scheme at its own SVG filter", () => {
    for (const scheme of DUOTONE_SCHEMES) expect(pageColorStyle(scheme)).toEqual({ filter: `url(#${pageColorFilterId(scheme)})` });
  });
});

describe("duotoneTables", () => {
  it("maps black ink to the text colour and white paper to the background", () => {
    expect(duotoneTables("yellowOnBlack")).toEqual({ r: "1 0", g: "1 0", b: "0 0" });
    expect(duotoneTables("whiteOnBlack")).toEqual({ r: "1 0", g: "1 0", b: "1 0" });
    expect(duotoneTables("sepia").r).toBe("0.357 0.957");
  });
});

describe("isPageColorScheme", () => {
  it("accepts only known schemes", () => {
    expect(isPageColorScheme("greenOnBlack")).toBe(true);
    expect(isPageColorScheme("purple")).toBe(false);
    expect(isPageColorScheme(1)).toBe(false);
  });
});
