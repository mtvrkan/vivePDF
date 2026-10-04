import { describe, expect, it } from "vitest";
import { isEveryPage, parsePageRange, pictureNames, selectPages } from "./exportPages";

describe("parsePageRange", () => {
  it("reads single pages and ranges in the typed order without repeats", () => {
    expect(parsePageRange("1-3, 5", 6)).toEqual({ ok: true, pages: [1, 2, 3, 5] });
    expect(parsePageRange(" 5 ,1-2, 2 ", 6)).toEqual({ ok: true, pages: [5, 1, 2] });
  });

  it("accepts open ends and reversed ranges", () => {
    expect(parsePageRange("4-", 6)).toEqual({ ok: true, pages: [4, 5, 6] });
    expect(parsePageRange("-2", 6)).toEqual({ ok: true, pages: [1, 2] });
    expect(parsePageRange("3-1", 6)).toEqual({ ok: true, pages: [3, 2, 1] });
  });

  it("explains empty, malformed and out-of-range input", () => {
    expect(parsePageRange("  ", 6)).toEqual({ ok: false, error: "empty" });
    expect(parsePageRange("1,,2", 6)).toEqual({ ok: false, error: "invalid" });
    expect(parsePageRange("a-b", 6)).toEqual({ ok: false, error: "invalid" });
    expect(parsePageRange("-", 6)).toEqual({ ok: false, error: "invalid" });
    expect(parsePageRange("1-2-3", 6)).toEqual({ ok: false, error: "invalid" });
    expect(parsePageRange("0", 6)).toEqual({ ok: false, error: "outOfRange" });
    expect(parsePageRange("2-9", 6)).toEqual({ ok: false, error: "outOfRange" });
    expect(parsePageRange("1,".repeat(300), 6)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("selectPages", () => {
  it("returns every page, the current page or the typed range", () => {
    expect(selectPages("all", "", 0, 3)).toEqual({ ok: true, pages: [1, 2, 3] });
    expect(selectPages("current", "", 1, 3)).toEqual({ ok: true, pages: [2] });
    expect(selectPages("custom", "3", 0, 3)).toEqual({ ok: true, pages: [3] });
  });

  it("keeps the current page inside the design", () => {
    expect(selectPages("current", "", 7, 3)).toEqual({ ok: true, pages: [3] });
    expect(selectPages("current", "", -1, 3)).toEqual({ ok: true, pages: [1] });
  });

  it("passes range errors through", () => {
    expect(selectPages("custom", "", 0, 3)).toEqual({ ok: false, error: "empty" });
  });
});

describe("isEveryPage", () => {
  it("is true only for every page in order", () => {
    expect(isEveryPage([1, 2, 3], 3)).toBe(true);
    expect(isEveryPage([1, 3, 2], 3)).toBe(false);
    expect(isEveryPage([1, 2], 3)).toBe(false);
  });
});

describe("pictureNames", () => {
  it("names one picture after the output and several after their page numbers", () => {
    expect(pictureNames("C:/out/card.png", "png", [2], 1)).toEqual(["card.png"]);
    expect(pictureNames("C:/out/card.png", "jpg", [2, 5], 1)).toEqual(["card-2.jpg", "card-5.jpg"]);
  });

  it("numbers copies from table rows one after another", () => {
    expect(pictureNames("C:/out/card.png", "png", [1, 2], 2)).toEqual(["card-1.png", "card-2.png", "card-3.png", "card-4.png"]);
  });

  it("falls back to a neutral name without an output", () => {
    expect(pictureNames("", "png", [1, 2], 1)).toEqual(["design-1.png", "design-2.png"]);
  });
});
