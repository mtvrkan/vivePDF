import type { DocumentSettings } from "@/types/studio";
import { MARGIN_LIMITS, MIN_TEXT_MM, POINTS_PER_MM } from "./model";
import { spacingValue } from "./spacing";

export const PX_PER_PT = 4 / 3;
export const MIN_LINE_PT = 36;
const TICK_MM = 2.5;
const EPSILON = 1e-6;

export type Indents = { left: number; right: number; firstLine: number };
export type IndentMarker = "firstLine" | "hanging" | "left" | "right";
export type MarginSide = "top" | "bottom" | "left" | "right";
export type Tick = { at: number; kind: "major" | "half" | "minor"; label: number | null };

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

export function snapToMillimetre(points: number): number {
  return Math.round(points / POINTS_PER_MM) * POINTS_PER_MM;
}

export function indentsOf(attributes: Record<string, unknown>): Indents {
  return {
    left: spacingValue("indentLeft", attributes.indentLeft) ?? 0,
    right: spacingValue("indentRight", attributes.indentRight) ?? 0,
    firstLine: spacingValue("firstLineIndent", attributes.firstLineIndent) ?? 0,
  };
}

export function draggedIndents(marker: IndentMarker, current: Indents, at: number, width: number): Indents {
  const { left, right, firstLine } = current;
  const longest = width - right - MIN_LINE_PT;
  if (marker === "firstLine") return { left, right, firstLine: clamp(at, 0, longest) - left };
  if (marker === "hanging") {
    const next = clamp(at, 0, longest);
    return { left: next, right, firstLine: left + firstLine - next };
  }
  if (marker === "left") return { left: clamp(at, Math.max(0, -firstLine), longest - Math.max(0, firstLine)), right, firstLine };
  return { left, right: clamp(width - at, 0, width - Math.max(left, left + firstLine) - MIN_LINE_PT), firstLine };
}

export function indentsPatch(indents: Indents): { indentLeft: number | null; indentRight: number | null; firstLineIndent: number | null } {
  const value = (amount: number) => (Math.abs(amount) < 0.01 ? null : Math.round(amount * 100) / 100);
  return { indentLeft: value(indents.left), indentRight: value(indents.right), firstLineIndent: value(indents.firstLine) };
}

type PageSettings = Pick<DocumentSettings, "marginTopMm" | "marginBottomMm" | "marginLeftMm" | "marginRightMm" | "gutterMm" | "gutterSide">;

export function draggedMargin(side: MarginSide, settings: PageSettings, at: number, page: { width: number; height: number }): Partial<DocumentSettings> {
  const gutter = (where: "left" | "top") => (settings.gutterSide === where ? settings.gutterMm : 0);
  const [low, high] = MARGIN_LIMITS.margin;
  const mm = Math.round(at / POINTS_PER_MM);
  const widthMm = page.width / POINTS_PER_MM;
  const heightMm = page.height / POINTS_PER_MM;
  const fit = (value: number, room: number) => Math.round(clamp(value, low, Math.min(high, room)));
  if (side === "left") return { marginLeftMm: fit(mm - gutter("left"), widthMm - settings.marginRightMm - gutter("left") - MIN_TEXT_MM) };
  if (side === "right") return { marginRightMm: fit(widthMm - mm, widthMm - settings.marginLeftMm - gutter("left") - MIN_TEXT_MM) };
  if (side === "top") return { marginTopMm: fit(mm - gutter("top"), heightMm - settings.marginBottomMm - gutter("top") - MIN_TEXT_MM) };
  return { marginBottomMm: fit(heightMm - mm, heightMm - settings.marginTopMm - gutter("top") - MIN_TEXT_MM) };
}

export function rulerTicks(length: number, origin: number): Tick[] {
  const step = TICK_MM * POINTS_PER_MM;
  const first = Math.ceil(-origin / step - EPSILON);
  const last = Math.floor((length - origin) / step + EPSILON);
  const ticks: Tick[] = [];
  for (let index = first; index <= last; index += 1) {
    const kind = index % 4 === 0 ? "major" : index % 2 === 0 ? "half" : "minor";
    const centimetres = Math.abs(index / 4);
    ticks.push({ at: origin + index * step, kind, label: kind === "major" && index !== 0 ? centimetres : null });
  }
  return ticks;
}
