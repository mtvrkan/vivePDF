import type { StudioDesign } from "@/types/studio";
import { MAX_PAGES } from "../model/design";

const MAX_PALETTE = 24;

export function insertTemplate(design: StudioDesign, pageId: string | null, template: StudioDesign): { design: StudioDesign; pageId: string } | null {
  const index = Math.max(0, design.pages.findIndex((page) => page.id === pageId));
  const current = design.pages[index];
  const replace = Boolean(current && !current.elements.length);
  const pages = [...design.pages.slice(0, replace ? index : index + 1), ...template.pages, ...design.pages.slice(index + 1)];
  if (pages.length > MAX_PAGES) return null;
  const palette = [...design.palette, ...template.palette.filter((color) => !design.palette.includes(color))].slice(0, MAX_PALETTE);
  const first = template.pages[0]?.id ?? current?.id ?? "";
  return { design: { ...design, name: design.name || template.name, palette, pages }, pageId: first };
}
