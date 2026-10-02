import { FontCharset } from "@embedpdf/models";
import type { FontFallbackConfig } from "@embedpdf/engines";
import fallbackFonts from "./fallbackFonts.json";

type CharsetName = keyof typeof FontCharset;

export const FALLBACK_FONT_SCHEME = "vivepdf-font";

export type FallbackFontSet = (typeof fallbackFonts.sets)[number];

function isCharsetName(name: string): name is CharsetName {
  return Object.prototype.hasOwnProperty.call(FontCharset, name) && typeof FontCharset[name as CharsetName] === "number";
}

export function fallbackFontBaseUrl(schemeRoot: string): string {
  return schemeRoot.replace(/\/+$/, "");
}

export function downloadableFontSets(): FallbackFontSet[] {
  return fallbackFonts.sets.filter((set) => !set.bundled);
}

export function fontSetBytes(set: FallbackFontSet): number {
  return set.files.reduce((total, entry) => total + entry.bytes, 0);
}

export function buildFontFallbackConfig(baseUrl: string): FontFallbackConfig {
  const fonts: FontFallbackConfig["fonts"] = {};
  for (const set of fallbackFonts.sets) {
    const variants = set.files.map((entry) => ({ url: entry.file, weight: entry.weight }));
    for (const name of set.charsets) {
      if (!isCharsetName(name)) throw new Error(`unknown font charset ${name}`);
      fonts[FontCharset[name]] = variants;
    }
  }
  return { fonts, baseUrl };
}
