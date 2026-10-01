import { describe, expect, it } from "vitest";
import { FontCharset } from "@embedpdf/models";
import { buildFontFallbackConfig, fallbackFontBaseUrl } from "./fontFallback";
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

  it("builds an absolute base url from the page origin", () => {
    expect(fallbackFontBaseUrl("http://tauri.localhost")).toBe(`http://tauri.localhost/${fallbackFonts.directory}`);
    expect(fallbackFontBaseUrl("http://localhost:1420")).toBe("http://localhost:1420/fonts/fallback");
  });

  it("only names charsets that exist", () => {
    for (const set of fallbackFonts.sets) {
      for (const name of set.charsets) expect(typeof FontCharset[name as keyof typeof FontCharset]).toBe("number");
    }
  });
});
