import { describe, expect, it } from "vitest";
import { FontCharset } from "@embedpdf/models";
import { buildFontFallbackConfig, downloadableFontSets, fallbackFontBaseUrl, fontSetBytes } from "./fontFallback";
import fallbackFonts from "./fallbackFonts.json";

describe("buildFontFallbackConfig", () => {
  it("maps CJK, Cyrillic and Greek charsets to the bundled Noto files", () => {
    const config = buildFontFallbackConfig("http://tauri.localhost/fonts/fallback");
    expect(config.baseUrl).toBe("http://tauri.localhost/fonts/fallback");
    expect(config.fonts[FontCharset.SHIFTJIS]).toEqual([{ url: "NotoSansJP-Regular.otf", weight: 400 }]);
    expect(config.fonts[FontCharset.HANGEUL]).toEqual([{ url: "NotoSansKR-Regular.otf", weight: 400 }]);
    expect(config.fonts[FontCharset.GB2312]).toEqual([{ url: "NotoSansHans-Regular.otf", weight: 400 }]);
    expect(config.fonts[FontCharset.CHINESEBIG5]).toEqual([{ url: "NotoSansHant-Regular.otf", weight: 400 }]);
    expect(config.fonts[FontCharset.ARABIC]).toBeUndefined();
    expect(config.fonts[FontCharset.HEBREW]).toBeUndefined();
    expect(config.fonts[FontCharset.CYRILLIC]).toBe(config.fonts[FontCharset.GREEK]);
  });

  it("uses relative file names so the manager prefixes the absolute base url", () => {
    const config = buildFontFallbackConfig("http://tauri.localhost/fonts/fallback");
    for (const entry of Object.values(config.fonts)) {
      for (const variant of entry as { url: string }[]) {
        expect(variant.url).not.toMatch(/^(\/|https?:)/);
      }
    }
  });

  it("leaves ANSI and unknown charsets unmapped so PDFium keeps its built-in fonts", () => {
    const config = buildFontFallbackConfig("x");
    expect(config.fonts[FontCharset.ANSI]).toBeUndefined();
    expect(config.defaultFont).toBeUndefined();
  });

  it("serves every fallback font from the font scheme root without a trailing slash", () => {
    expect(fallbackFontBaseUrl("http://vivepdf-font.localhost/")).toBe("http://vivepdf-font.localhost");
    expect(fallbackFontBaseUrl("vivepdf-font://localhost/")).toBe("vivepdf-font://localhost");
  });

  it("downloads the CJK sets on demand and keeps only the Latin set bundled", () => {
    expect(downloadableFontSets().map((set) => set.id)).toEqual(["ja", "ko", "zh-Hans", "zh-Hant"]);
    expect(fallbackFonts.sets.filter((set) => set.bundled).map((set) => set.id)).toEqual(["latin"]);
    expect(fontSetBytes(downloadableFontSets()[0])).toBe(4538888);
    for (const set of fallbackFonts.sets) {
      for (const entry of set.files) expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("only names charsets that exist", () => {
    for (const set of fallbackFonts.sets) {
      for (const name of set.charsets) expect(typeof FontCharset[name as keyof typeof FontCharset]).toBe("number");
    }
  });
});
