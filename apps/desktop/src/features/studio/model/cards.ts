import type { StudioDesign, StudioPage } from "@/types/studio";
import { createDesign, createPage, MAX_CORNER_MM, STUDIO_PAGE_SIZES, type StudioPageSize } from "./design";

export const CARD_SIZES = ["businessCardEu", "businessCardWide", "businessCard", "businessCardSquare", "businessCardMini"] as const satisfies readonly StudioPageSize[];

export type CardSize = (typeof CARD_SIZES)[number];

export function isCardPage(page: Pick<StudioPage, "width" | "height">): boolean {
  return CARD_SIZES.some((size) => {
    const { width, height } = STUDIO_PAGE_SIZES[size];
    const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
    return (same(width, page.width) && same(height, page.height)) || (same(width, page.height) && same(height, page.width));
  });
}

export function createCardDesign(size: CardSize, sides: { front: string; back: string }): StudioDesign {
  const { width, height } = STUDIO_PAGE_SIZES[size];
  const design = createDesign("", width, height);
  return { ...design, pages: [{ ...design.pages[0], name: sides.front }, { ...createPage(width, height), name: sides.back }] };
}

export function cornerOf(design: Pick<StudioDesign, "print">): number {
  return design.print?.cornerMm ?? 0;
}

export function withCorner(design: StudioDesign, millimetres: number): StudioDesign {
  const cornerMm = Number.isFinite(millimetres) ? Math.min(MAX_CORNER_MM, Math.max(0, millimetres)) : 0;
  if (cornerOf(design) === cornerMm) return design;
  const { print, ...rest } = design;
  const others = { ...print };
  delete others.cornerMm;
  const next = cornerMm > 0 ? { ...others, cornerMm } : others;
  return Object.keys(next).length ? { ...rest, print: next } : rest;
}
