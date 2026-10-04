import { hexToRgb, rgbToHex } from "@/shared/lib/color";
import type { StudioGradientStop } from "@/types/studio";
import { MAX_GRADIENT_STOPS } from "../model/design";
import { sortedStops } from "../model/shapes";

export const MIN_GRADIENT_STOPS = 2;

export type StopEdit = { stops: StudioGradientStop[]; index: number };

export const GRADIENT_PRESETS: StudioGradientStop[][] = [
  [{ offset: 0, color: "#ff7a59" }, { offset: 1, color: "#ffd166" }],
  [{ offset: 0, color: "#3a7bd5" }, { offset: 1, color: "#00d2ff" }],
  [{ offset: 0, color: "#8e2de2" }, { offset: 1, color: "#ff6fd8" }],
  [{ offset: 0, color: "#11998e" }, { offset: 1, color: "#38ef7d" }],
  [{ offset: 0, color: "#0f2027" }, { offset: 0.5, color: "#203a43" }, { offset: 1, color: "#2c5364" }],
  [{ offset: 0, color: "#f8f9fa" }, { offset: 1, color: "#ced4da" }],
  [{ offset: 0, color: "#ff512f" }, { offset: 0.5, color: "#dd2476" }, { offset: 1, color: "#6a3093" }],
  [{ offset: 0, color: "#fceabb" }, { offset: 0.5, color: "#f8b500" }, { offset: 1, color: "#c76b00" }],
];

function clampOffset(offset: number): number {
  return Math.round(Math.min(1, Math.max(0, offset)) * 1000) / 1000;
}

function mix(left: string, right: string, amount: number): string {
  const from = hexToRgb(left);
  const to = hexToRgb(right);
  return rgbToHex({ r: from.r + (to.r - from.r) * amount, g: from.g + (to.g - from.g) * amount, b: from.b + (to.b - from.b) * amount });
}

export function colorAt(stops: StudioGradientStop[], offset: number): string {
  const ordered = sortedStops(stops);
  if (!ordered.length) return "#000000";
  if (offset <= ordered[0].offset) return ordered[0].color;
  const last = ordered[ordered.length - 1];
  if (offset >= last.offset) return last.color;
  const after = ordered.findIndex((stop) => stop.offset >= offset);
  const left = ordered[after - 1];
  const right = ordered[after];
  const span = right.offset - left.offset;
  return span <= 0 ? right.color : mix(left.color, right.color, (offset - left.offset) / span);
}

function reorder(stops: StudioGradientStop[], moved: StudioGradientStop): StopEdit {
  const ordered = sortedStops(stops);
  return { stops: ordered, index: ordered.indexOf(moved) };
}

export function canAddStop(stops: StudioGradientStop[]): boolean {
  return stops.length < MAX_GRADIENT_STOPS;
}

export function canRemoveStop(stops: StudioGradientStop[]): boolean {
  return stops.length > MIN_GRADIENT_STOPS;
}

export function addStop(stops: StudioGradientStop[], offset: number): StopEdit | null {
  if (!canAddStop(stops)) return null;
  const position = clampOffset(offset);
  const added = { offset: position, color: colorAt(stops, position) };
  return reorder([...stops, added], added);
}

export function widestGapMiddle(stops: StudioGradientStop[]): number {
  const offsets = [0, ...sortedStops(stops).map((stop) => stop.offset), 1];
  let best = { width: -1, middle: 0.5 };
  for (let index = 1; index < offsets.length; index += 1) {
    const width = offsets[index] - offsets[index - 1];
    if (width > best.width) best = { width, middle: (offsets[index] + offsets[index - 1]) / 2 };
  }
  return clampOffset(best.middle);
}

export function moveStop(stops: StudioGradientStop[], index: number, offset: number): StopEdit {
  const target = stops[index];
  if (!target) return { stops, index };
  const moved = { ...target, offset: clampOffset(offset) };
  return reorder(stops.map((stop, position) => (position === index ? moved : stop)), moved);
}

export function removeStop(stops: StudioGradientStop[], index: number): StopEdit {
  if (!canRemoveStop(stops) || !stops[index]) return { stops, index };
  const next = stops.filter((_, position) => position !== index);
  return { stops: next, index: Math.min(index, next.length - 1) };
}

export function setStopColor(stops: StudioGradientStop[], index: number, color: string): StudioGradientStop[] {
  return stops.map((stop, position) => (position === index ? { ...stop, color } : stop));
}

export function reverseStops(stops: StudioGradientStop[]): StudioGradientStop[] {
  return sortedStops(stops.map((stop) => ({ ...stop, offset: clampOffset(1 - stop.offset) })));
}

export function gradientCss(stops: StudioGradientStop[], direction = "90deg"): string {
  const ordered = sortedStops(stops);
  const parts = ordered.length === 1 ? [ordered[0], ordered[0]] : ordered;
  return `linear-gradient(${direction}, ${parts.map((stop) => `${stop.color} ${Math.round(stop.offset * 1000) / 10}%`).join(", ")})`;
}
