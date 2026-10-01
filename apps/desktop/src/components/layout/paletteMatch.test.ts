import { describe, expect, it } from "vitest";
import { detectPaletteMode, parsePageQuery, scoreEntry, tokenize } from "./paletteMatch";

describe("scoreEntry", () => {
  it("scores a prefix match higher than a substring match", () => {
    const prefixScore = scoreEntry("com", { title: "Compress" }, "en");
    const substringScore = scoreEntry("com", { title: "Decompress" }, "en");
    expect(prefixScore).toBeGreaterThan(substringScore);
  });

  it("matches across Turkish diacritics regardless of accents", () => {
    expect(scoreEntry("sikistir", { title: "Sıkıştır" }, "tr")).toBeGreaterThan(0);
  });

  it("requires every query token to match somewhere", () => {
    expect(scoreEntry("numbers add", { title: "Add Page Numbers" }, "en")).toBeGreaterThan(0);
    expect(scoreEntry("numbers zzz", { title: "Add Page Numbers" }, "en")).toBe(0);
  });

  it("returns 0 when nothing matches", () => {
    expect(scoreEntry("zzzzz", { title: "Compress" }, "en")).toBe(0);
  });

  it("returns 0 for an empty query", () => {
    expect(tokenize("", "en")).toEqual([]);
    expect(scoreEntry("", { title: "Compress" }, "en")).toBe(0);
  });
});

describe("parsePageQuery", () => {
  it("parses plain numbers and p/s/# prefixed page references", () => {
    expect(parsePageQuery("12")).toBe(12);
    expect(parsePageQuery("p 12")).toBe(12);
    expect(parsePageQuery("s 12")).toBe(12);
    expect(parsePageQuery("abc")).toBeNull();
    expect(parsePageQuery("0")).toBeNull();
  });
});

describe("detectPaletteMode", () => {
  it("detects the prefix mode and strips it from the query", () => {
    expect(detectPaletteMode(">merge")).toEqual({ mode: "actions", rest: "merge" });
    expect(detectPaletteMode("/settings")).toEqual({ mode: "pages", rest: "settings" });
    expect(detectPaletteMode("@report")).toEqual({ mode: "documents", rest: "report" });
    expect(detectPaletteMode("#12")).toEqual({ mode: "page", rest: "12" });
    expect(detectPaletteMode("merge")).toEqual({ mode: null, rest: "merge" });
  });
});
