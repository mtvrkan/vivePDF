import type { StudioDesign, StudioTextElement } from "@/types/studio";
import { textOf } from "../model/design";
import { composeCv, type CvLabels, type CvMeasure } from "./cvLayout";
import { specOf } from "./cvDesigns";
import { CV_CONTACT_KINDS, CV_SECTION_KEYS, MAX_LEVEL, type CvProfile, type CvTheme } from "./cvModel";

export type Translate = (key: string, values?: Record<string, string | number>) => string;

const ESTIMATE_WIDTH = 0.53;
const ESTIMATE_BOLD = 1.07;
const ESTIMATE_UPPER = 1.18;

export function cvLabels(t: Translate): CvLabels {
  const sections = Object.fromEntries([...CV_SECTION_KEYS, "contact"].map((key) => [key, t(`studio.cv.sections.${key}`)])) as CvLabels["sections"];
  const contacts = Object.fromEntries(CV_CONTACT_KINDS.map((kind) => [kind, t(`studio.cv.contactKinds.${kind}`)])) as CvLabels["contacts"];
  return { sections, contacts, present: t("studio.cv.present"), levels: Array.from({ length: MAX_LEVEL }, (_, index) => t(`studio.cv.levels.${index + 1}`)),
    languageLevels: Array.from({ length: MAX_LEVEL }, (_, index) => t(`studio.cv.languageLevels.${index + 1}`)),
  };
}

function wrappedLines(paragraph: string, perLine: number): number {
  if (!paragraph.trim()) return 1;
  let lines = 1;
  let used = 0;
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const length = word.length;
    if (used === 0) {
      lines += Math.floor(Math.max(0, length - 1) / perLine);
      used = length % perLine || perLine;
    } else if (used + 1 + length <= perLine) {
      used += 1 + length;
    } else {
      lines += 1 + Math.floor(Math.max(0, length - 1) / perLine);
      used = length % perLine || perLine;
    }
  }
  return lines;
}

export const estimateMeasure: CvMeasure = (element: StudioTextElement) => {
  const size = element.fontSize;
  const glyph = size * ESTIMATE_WIDTH * (element.bold ? ESTIMATE_BOLD : 1) * (element.uppercase ? ESTIMATE_UPPER : 1) + element.letterSpacing * size;
  const perLine = Math.max(1, Math.floor(element.width / glyph));
  const lines = textOf(element.runs)
    .split("\n")
    .reduce((sum, paragraph) => sum + wrappedLines(paragraph, perLine), 0);
  return lines * size * element.lineHeight + 2;
};

export function sampleCv(profile: CvProfile, theme: CvTheme, t: Translate, name: string): StudioDesign {
  return composeCv(specOf(theme.layout), { profile, theme, labels: cvLabels(t), measure: estimateMeasure, emptyPhoto: true, name });
}
