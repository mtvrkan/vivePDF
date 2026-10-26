import type { DocumentSettings } from "@/types/studio";

export const THESIS_RULES = ["left40", "left35"] as const;
export type ThesisRule = (typeof THESIS_RULES)[number];

export const THESIS_FONT = "Times New Roman";
export const THESIS_INDENT_PT = 35.43;

const SHARED = { paper: "a4", landscape: false, gutterMm: 0, columns: 1, fontSize: 12, lineHeight: 1.5, pageNumbers: "center", pageNumberFormat: "{n}" } satisfies Partial<DocumentSettings>;

export const THESIS_LAYOUTS: Record<ThesisRule, Partial<DocumentSettings>> = {
  left40: { ...SHARED, marginTopMm: 25, marginBottomMm: 25, marginLeftMm: 40, marginRightMm: 25 },
  left35: { ...SHARED, marginTopMm: 30, marginBottomMm: 30, marginLeftMm: 35, marginRightMm: 25 },
};

export function thesisRuleOf(settings: DocumentSettings): ThesisRule | null {
  return THESIS_RULES.find((rule) => Object.entries(THESIS_LAYOUTS[rule]).every(([key, value]) => settings[key as keyof DocumentSettings] === value)) ?? null;
}
