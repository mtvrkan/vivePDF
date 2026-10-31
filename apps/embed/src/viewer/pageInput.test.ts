import { describe, expect, it } from "vitest";
import { formatZoom, parsePageInput, zoomPercent } from "./pageInput";

describe("parsePageInput", () => {
  it("reads a page number inside the document", () => {
    const page = parsePageInput(" 12 ", 500);

    expect(page).toBe(12);
  });

  it("clamps numbers outside the document to the first or last page", () => {
    const pages = [parsePageInput("0", 20), parsePageInput("999", 20)];

    expect(pages).toEqual([1, 20]);
  });

  it("rejects text, signs and empty documents", () => {
    const pages = [parsePageInput("abc", 20), parsePageInput("-3", 20), parsePageInput("", 20), parsePageInput("2", 0)];

    expect(pages).toEqual([null, null, null, null]);
  });
});

describe("formatZoom", () => {
  it("shows the level as a whole percentage", () => {
    const labels = [formatZoom(1), formatZoom(1.254), formatZoom(0.5)];

    expect(labels).toEqual(["100%", "125%", "50%"]);
  });
});

describe("zoomPercent", () => {
  it("turns a scale into a percentage with one decimal", () => {
    const percents = [zoomPercent(1), zoomPercent(1.4725), zoomPercent(0.1)];

    expect(percents).toEqual([100, 147.3, 10]);
  });
});
