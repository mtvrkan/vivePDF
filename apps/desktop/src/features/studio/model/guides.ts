import type { StudioDesign, StudioGuide, StudioPage } from "@/types/studio";
import { MAX_GUIDES_PER_PAGE, MAX_MARGIN_MM } from "./design";

export function guidesOf(page: StudioPage): StudioGuide[] {
  return page.guides ?? [];
}

export function addGuide(page: StudioPage, guide: StudioGuide): StudioPage {
  const guides = guidesOf(page);
  if (guides.length >= MAX_GUIDES_PER_PAGE || !Number.isFinite(guide.position)) return page;
  return { ...page, guides: [...guides, guide] };
}

export function moveGuide(page: StudioPage, index: number, position: number): StudioPage {
  const guides = guidesOf(page);
  if (!guides[index] || !Number.isFinite(position) || guides[index].position === position) return page;
  return { ...page, guides: guides.map((guide, at) => (at === index ? { ...guide, position } : guide)) };
}

export function removeGuide(page: StudioPage, index: number): StudioPage {
  const guides = guidesOf(page);
  if (!guides[index]) return page;
  return { ...page, guides: guides.filter((_, at) => at !== index) };
}

export function clearGuides(page: StudioPage): StudioPage {
  return guidesOf(page).length ? { ...page, guides: [] } : page;
}

export function marginsOf(design: StudioDesign): number {
  return design.margins ?? 0;
}

export function withMargins(design: StudioDesign, millimetres: number): StudioDesign {
  const margins = Number.isFinite(millimetres) ? Math.min(MAX_MARGIN_MM, Math.max(0, millimetres)) : 0;
  return marginsOf(design) === margins ? design : { ...design, margins };
}
