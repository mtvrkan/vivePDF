import type { SpaceFont, SpaceImageFormat } from "@/types";

export const SHOWN_PAGES = 5;
export const SHOWN_ITEMS = 5;

const IMAGE_FORMAT_NAMES: Partial<Record<SpaceImageFormat, string>> = { jpeg: "JPEG", jpeg2000: "JPEG 2000", jbig2: "JBIG2", ccitt: "CCITT" };
const FONT_FORMAT_NAMES: Record<SpaceFont["format"], string> = { type1: "Type 1", truetype: "TrueType", cff: "CFF", opentype: "OpenType" };

export type Named = { name: string } | { key: string };

export function imageFormatName(format: SpaceImageFormat): Named {
  const name = IMAGE_FORMAT_NAMES[format];
  return name ? { name } : { key: `tools.compress.largest.formats.${format}` };
}

export function fontFormatName(format: SpaceFont["format"]): string {
  return FONT_FORMAT_NAMES[format];
}

export function pageList(pages: number[], format: (value: number) => string, limit = SHOWN_PAGES): string {
  const shown = pages.slice(0, limit).map(format).join(", ");
  return pages.length > limit ? `${shown} …` : shown;
}
