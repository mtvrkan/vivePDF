import type { FontFallbackConfig } from "@embedpdf/engines";
import { FontCharset } from "@embedpdf/models";
import families from "./fallbackFonts.json";

type Family = { package: string; charsets: (keyof typeof FontCharset)[]; files: [string, number][] };

export function fallbackFonts(base: string): FontFallbackConfig {
  const fonts: FontFallbackConfig["fonts"] = {};
  for (const family of families as Family[]) {
    const entries = family.files.map(([file, weight]) => ({ url: new URL(file, base).href, weight }));
    for (const charset of family.charsets) fonts[FontCharset[charset]] = entries;
  }
  return { fonts };
}
