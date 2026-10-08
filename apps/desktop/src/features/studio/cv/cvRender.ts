import type { StudioDesign, StudioElement, StudioPage } from "@/types/studio";
import { ensureFace, useStudioFontsStore } from "../design/fonts";
import { buildTextNode } from "../design/measure";
import { textOf } from "../model/design";
import { composeCv, type CvMeasure } from "./cvLayout";
import { specOf } from "./cvDesigns";
import type { CvProfile, CvTheme } from "./cvModel";
import { cvLabels, type Translate } from "./cvSample";

const MEASURE_CACHE_LIMIT = 4000;
const measuredHeights = new Map<string, number>();

useStudioFontsStore.subscribe(() => measuredHeights.clear());

export function domMeasure(language: string): { measure: CvMeasure; dispose: () => void } {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style";
  document.body.append(host);
  const measure: CvMeasure = (element) => {
    const key = [language, element.fontId, element.fontSize, element.bold, element.italic, element.textCase, element.letterSpacing, element.lineHeight, Math.round(element.width * 10), textOf(element.runs)].join("|");
    const known = measuredHeights.get(key);
    if (known !== undefined) return known;
    const { frame, body } = buildTextNode(element, language);
    host.append(frame);
    const height = body.offsetHeight;
    frame.remove();
    if (measuredHeights.size >= MEASURE_CACHE_LIMIT) measuredHeights.clear();
    measuredHeights.set(key, height);
    return height;
  };
  return { measure, dispose: () => host.remove() };
}

function sameData(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function keepUnchanged(next: StudioDesign, previous: StudioDesign | null): StudioDesign {
  const pages = next.pages.map((page, pageIndex): StudioPage => {
    const before = previous?.pages[pageIndex];
    const elements = page.elements.map((element, index): StudioElement => {
      const placed = { ...element, id: `cv-${pageIndex}-${index}` };
      const prior = before?.elements[index];
      return prior && sameData(prior, placed) ? prior : placed;
    });
    const placed = { ...page, id: `cv-page-${pageIndex}`, elements };
    const reused = before && before.elements.length === elements.length && elements.every((element, index) => element === before.elements[index]) && sameData({ ...before, elements: [] }, { ...placed, elements: [] });
    return reused ? before : placed;
  });
  return { ...next, pages };
}

export async function loadCvFonts(fontIds: string[]): Promise<void> {
  const unique = [...new Set(fontIds)];
  await Promise.all(unique.flatMap((id) => [400, 700].flatMap((weight) => [false, true].map((italic) => ensureFace(id, weight, italic)))));
  await document.fonts.ready;
}

export function cvFonts(theme: CvTheme): string[] {
  const spec = specOf(theme.layout);
  return [theme.headingFont ?? spec.fonts.heading, theme.bodyFont ?? spec.fonts.body];
}

export async function renderCv(profile: CvProfile, theme: CvTheme, t: Translate, name: string): Promise<StudioDesign> {
  await loadCvFonts(cvFonts(theme));
  const measurer = domMeasure(theme.language);
  try {
    return composeCv(specOf(theme.layout), { profile, theme, labels: cvLabels(t), measure: measurer.measure, emptyPhoto: false, name });
  } finally {
    measurer.dispose();
  }
}
