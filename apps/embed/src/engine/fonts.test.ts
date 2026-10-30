import { FontCharset } from "@embedpdf/models";
import { describe, expect, it } from "vitest";
import { parseFontBase } from "./fontBase";
import { fallbackFonts } from "./fonts";

describe("parseFontBase", () => {
  it("resolves a relative folder against the page and adds the closing slash", () => {
    const base = parseFontBase("/static/vivepdf-fonts", "https://example.com/docs/page.html");

    expect(base).toBe("https://example.com/static/vivepdf-fonts/");
  });

  it("is off when the attribute is missing or blank", () => {
    const bases = [parseFontBase(null, "https://example.com/"), parseFontBase("  ", "https://example.com/")];

    expect(bases).toEqual([null, null]);
  });

  it("refuses addresses that are not http or https", () => {
    const bases = [parseFontBase("javascript:alert(1)", "https://example.com/"), parseFontBase("data:text/plain,x", "https://example.com/")];

    expect(bases).toEqual([null, null]);
  });
});

describe("fallbackFonts", () => {
  it("points every charset at regular and bold files in the given folder", () => {
    const config = fallbackFonts("https://cdn.example.net/fonts/");

    expect(config.fonts[FontCharset.SHIFTJIS]).toEqual([
      { url: "https://cdn.example.net/fonts/NotoSansJP-Regular.otf", weight: 400 },
      { url: "https://cdn.example.net/fonts/NotoSansJP-Bold.otf", weight: 700 },
    ]);
    expect(config.fonts[FontCharset.GREEK]).toBe(config.fonts[FontCharset.CYRILLIC]);
  });

  it("covers the Asian, Cyrillic, Greek, Vietnamese, Hebrew and Arabic charsets and nothing it has no file for", () => {
    const config = fallbackFonts("https://cdn.example.net/fonts/");

    const covered = Object.keys(config.fonts).map(Number).sort((a, b) => a - b);

    expect(covered).toEqual(
      [FontCharset.SHIFTJIS, FontCharset.HANGEUL, FontCharset.GB2312, FontCharset.CHINESEBIG5, FontCharset.GREEK, FontCharset.VIETNAMESE, FontCharset.HEBREW, FontCharset.ARABIC, FontCharset.CYRILLIC].sort((a, b) => a - b),
    );
  });
});
