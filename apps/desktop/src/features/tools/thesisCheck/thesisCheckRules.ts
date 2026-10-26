import { THESIS_FONT, THESIS_LAYOUTS, THESIS_RULES, type ThesisRule } from "@/features/studio/document/thesisRules";
import type { ThesisCheckItem, ThesisCheckRules, ThesisNumberPlace, ThesisPaper } from "@/types";

export type ThesisPreset = ThesisRule | "custom";
export type ThesisCheckGroup = "layout" | "text" | "numbers";

export const THESIS_PRESETS: readonly ThesisPreset[] = [...THESIS_RULES, "custom"];
export const THESIS_PAPERS: readonly ThesisPaper[] = ["a4", "a5", "b5", "letter", "legal", "any"];
export const THESIS_NUMBER_PLACES: readonly ThesisNumberPlace[] = ["center", "right", "outside", "any"];
export const MARGIN_SIDES = ["top", "bottom", "left", "right"] as const;
export const LIMITS = { margin: [0, 100], fontSize: [4, 40], lineHeight: [0.8, 3] } as const;

const GROUPS: Record<string, ThesisCheckGroup> = {
  text: "layout",
  paper: "layout",
  marginTop: "layout",
  marginBottom: "layout",
  marginLeft: "layout",
  marginRight: "layout",
  bodyFont: "text",
  bodySize: "text",
  lineSpacing: "text",
  headings: "text",
  pageNumbers: "numbers",
  pageNumberPlace: "numbers",
  pageNumberOrder: "numbers",
  frontRoman: "numbers",
};
export const CHECK_GROUPS: readonly ThesisCheckGroup[] = ["layout", "text", "numbers"];

export function presetRules(rule: ThesisRule): ThesisCheckRules {
  const layout = THESIS_LAYOUTS[rule];
  const place = layout.pageNumbers;
  return {
    paper: layout.paper ?? "a4",
    marginsMm: { top: layout.marginTopMm ?? 25, bottom: layout.marginBottomMm ?? 25, left: layout.marginLeftMm ?? 25, right: layout.marginRightMm ?? 25 },
    mirrored: false,
    fontFamily: THESIS_FONT,
    fontSize: layout.fontSize ?? 12,
    lineHeight: layout.lineHeight ?? 1.5,
    pageNumbers: place === "center" || place === "right" || place === "outside" ? place : "any",
    frontRoman: true,
  };
}

function sameRules(left: ThesisCheckRules, right: ThesisCheckRules): boolean {
  return (
    left.paper === right.paper &&
    MARGIN_SIDES.every((side) => left.marginsMm[side] === right.marginsMm[side]) &&
    left.mirrored === right.mirrored &&
    left.fontFamily.trim().toLowerCase() === right.fontFamily.trim().toLowerCase() &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight &&
    left.pageNumbers === right.pageNumbers &&
    left.frontRoman === right.frontRoman
  );
}

export function presetOf(rules: ThesisCheckRules): ThesisPreset {
  return THESIS_RULES.find((rule) => sameRules(presetRules(rule), rules)) ?? "custom";
}

export function clampRule(value: number, [low, high]: readonly [number, number]): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low;
}

export function groupOf(item: ThesisCheckItem): ThesisCheckGroup {
  return GROUPS[item.id] ?? "layout";
}

export function checksByGroup(items: ThesisCheckItem[]): Array<{ group: ThesisCheckGroup; items: ThesisCheckItem[] }> {
  return CHECK_GROUPS.map((group) => ({ group, items: items.filter((item) => groupOf(item) === group) })).filter((entry) => entry.items.length > 0);
}

export function localNumber(value: string | null, locale: string): string {
  if (value === null) return "";
  if (!/^\d+(\.\d+)?$/.test(value)) return value.replace(/(\d+)\.(\d+)/g, (_, whole: string, part: string) => Number(`${whole}.${part}`).toLocaleString(locale));
  return Number(value).toLocaleString(locale, { minimumFractionDigits: value.includes(".") ? 1 : 0, maximumFractionDigits: 1 });
}
