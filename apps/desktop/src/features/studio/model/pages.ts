import type { StudioDesign, StudioElement, StudioPage } from "@/types/studio";
import { MAX_PAGE_SIDE, MAX_PAGES, MIN_ELEMENT_SIDE, MIN_PAGE_SIDE, createPage, newId } from "./design";
import { groupMapper } from "./edit";

export type PageResizeMode = "keep" | "scale";

export function addPage(design: StudioDesign, afterId: string | null): { design: StudioDesign; pageId: string | null } {
  if (design.pages.length >= MAX_PAGES) return { design, pageId: null };
  const index = afterId ? design.pages.findIndex((page) => page.id === afterId) : design.pages.length - 1;
  const template = design.pages[Math.max(0, index)];
  const page = createPage(template.width, template.height);
  const pages = [...design.pages];
  pages.splice(index + 1, 0, page);
  return { design: { ...design, pages }, pageId: page.id };
}

export function duplicatePage(design: StudioDesign, pageId: string): { design: StudioDesign; pageId: string | null } {
  const index = design.pages.findIndex((page) => page.id === pageId);
  if (index < 0 || design.pages.length >= MAX_PAGES) return { design, pageId: null };
  const regroup = groupMapper();
  const source = design.pages[index];
  const copy: StudioPage = {
    ...structuredClone(source),
    id: newId(),
    elements: source.elements.map((element) => ({ ...structuredClone(element), id: newId(), groupId: regroup(element.groupId) })),
  };
  const pages = [...design.pages];
  pages.splice(index + 1, 0, copy);
  return { design: { ...design, pages }, pageId: copy.id };
}

export function removePage(design: StudioDesign, pageId: string): StudioDesign {
  if (design.pages.length <= 1) return design;
  return { ...design, pages: design.pages.filter((page) => page.id !== pageId) };
}

export function movePage(design: StudioDesign, pageId: string, index: number): StudioDesign {
  const from = design.pages.findIndex((page) => page.id === pageId);
  if (from < 0) return design;
  const pages = [...design.pages];
  const [page] = pages.splice(from, 1);
  pages.splice(Math.max(0, Math.min(pages.length, index)), 0, page);
  return { ...design, pages };
}

function pageSide(value: number): number {
  return Math.min(MAX_PAGE_SIDE, Math.max(MIN_PAGE_SIDE, Number.isFinite(value) ? value : MIN_PAGE_SIDE));
}

function scaledStroke<T extends { width: number }>(stroke: T | null, factor: number): T | null {
  return stroke ? { ...stroke, width: Math.min(500, Math.max(0.1, stroke.width * factor)) } : null;
}

function scaleElement(element: StudioElement, factor: number, dx: number, dy: number): StudioElement {
  const box = {
    ...element,
    x: element.x * factor + dx,
    y: element.y * factor + dy,
    width: Math.max(MIN_ELEMENT_SIDE, element.width * factor),
    height: Math.max(MIN_ELEMENT_SIDE, element.height * factor),
  };
  if (box.kind === "text") return { ...box, fontSize: Math.min(1000, Math.max(1, box.fontSize * factor)) };
  if (box.kind === "shape" || box.kind === "image") return { ...box, cornerRadius: box.cornerRadius * factor, stroke: scaledStroke(box.stroke, factor) };
  return box;
}

export function resizePage(page: StudioPage, width: number, height: number, mode: PageResizeMode): StudioPage {
  const nextWidth = pageSide(width);
  const nextHeight = pageSide(height);
  if (nextWidth === page.width && nextHeight === page.height) return page;
  if (mode === "keep" || !page.elements.length) return { ...page, width: nextWidth, height: nextHeight };
  const factor = Math.min(nextWidth / page.width, nextHeight / page.height);
  const dx = (nextWidth - page.width * factor) / 2;
  const dy = (nextHeight - page.height * factor) / 2;
  return { ...page, width: nextWidth, height: nextHeight, elements: page.elements.map((element) => scaleElement(element, factor, dx, dy)) };
}

export function resizeAllPages(design: StudioDesign, width: number, height: number, mode: PageResizeMode): StudioDesign {
  const pages = design.pages.map((page) => resizePage(page, width, height, mode));
  return pages.every((page, index) => page === design.pages[index]) ? design : { ...design, pages };
}
