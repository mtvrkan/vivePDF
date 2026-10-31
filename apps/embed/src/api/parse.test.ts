import { describe, expect, it } from "vitest";
import { parseMode, parsePageSetting, parseZoomSetting } from "./parse";

describe("parseZoomSetting", () => {
  it("reads fit modes and percentages with or without a percent sign", () => {
    const zooms = ["fit-width", " Fit-Page ", "150", "75%", "112.5", 200].map(parseZoomSetting);

    expect(zooms).toEqual(["fit-width", "fit-page", 150, 75, 112.5, 200]);
  });

  it("keeps a percentage inside the zoom range", () => {
    const zooms = ["5", "5000", 0].map(parseZoomSetting);

    expect(zooms).toEqual([10, 800, 10]);
  });

  it("ignores anything else", () => {
    const zooms = [null, undefined, "", "auto", "1.5x", "-20", Number.NaN].map(parseZoomSetting);

    expect(zooms).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("parsePageSetting", () => {
  it("reads a page number from an attribute or a number", () => {
    const pages = ["3", " 12 ", 7].map(parsePageSetting);

    expect(pages).toEqual([3, 12, 7]);
  });

  it("refuses zero, negatives, fractions and words", () => {
    const pages = ["0", "-2", "2.5", 2.5, "two", "", null].map(parsePageSetting);

    expect(pages).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("parseMode", () => {
  it("reads the four modes in any case", () => {
    const modes = ["inline", " FULL ", "Lightbox", "sized"].map(parseMode);

    expect(modes).toEqual(["inline", "full", "lightbox", "sized"]);
  });

  it("falls back to a sized box when the attribute is missing or unknown", () => {
    const modes = [null, "", "modal"].map(parseMode);

    expect(modes).toEqual(["sized", "sized", "sized"]);
  });
});
