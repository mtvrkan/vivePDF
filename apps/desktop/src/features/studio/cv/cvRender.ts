import type { StudioDesign } from "@/types/studio";
import { ensureFace } from "../design/fonts";
import { buildTextNode } from "../design/measure";
import { textOf } from "../model/design";
import { composeCv, type CvMeasure } from "./cvLayout";
import { specOf } from "./cvDesigns";
import type { CvProfile, CvTheme } from "./cvModel";
import { cvLabels, type Translate } from "./cvSample";

export function domMeasure(language: string): { measure: CvMeasure; dispose: () => void } {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style";
  document.body.append(host);
  const cache = new Map<string, number>();
  const measure: CvMeasure = (element) => {
    const key = [element.fontId, element.fontSize, element.bold, element.italic, element.textCase, element.letterSpacing, element.lineHeight, Math.round(element.width * 10), textOf(element.runs)].join("|");
    const known = cache.get(key);
    if (known !== undefined) return known;
    const { frame, body } = buildTextNode(element, language);
    host.append(frame);
    const height = body.offsetHeight;
    frame.remove();
    cache.set(key, height);
    return height;
  };
  return { measure, dispose: () => host.remove() };
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
