import type { StudioCornerRadii, StudioDropShadow, StudioElement, StudioImageElement, StudioPage, StudioShapeElement, StudioStroke, StudioTextElement } from "@/types/studio";
import { moveElements, type Bounds } from "../model/edit";
import { isLineShape, strokeCap, strokeJoin } from "../model/shapes";
import { boundsOf, MIN_SIDE, scaleElements } from "./transform";

export type Shared<T> = { value: T; mixed: boolean };

export type FillableElement = StudioShapeElement;
export type StrokableElement = StudioShapeElement | StudioImageElement;
export type RoundableElement = StudioShapeElement | StudioImageElement;
export type ShadowableElement = Exclude<StudioElement, StudioTextElement>;

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  for (const key of keys) if (!deepEqual(leftRecord[key], rightRecord[key])) return false;
  return true;
}

export function sharedValue<T>(values: readonly T[]): Shared<T> {
  const [first] = values;
  return { value: first, mixed: values.some((value) => !deepEqual(value, first)) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeEdit<T>(target: T, before: T, after: T): T {
  if (after === null || before === null) return after;
  if (target === null) return target;
  if (!isRecord(target) || !isRecord(before) || !isRecord(after)) return after;
  if (before.type !== after.type || target.type !== after.type) return after;
  const merged: Record<string, unknown> = { ...target };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (deepEqual(before[key], after[key])) continue;
    if (after[key] === undefined) delete merged[key];
    else merged[key] = after[key];
  }
  return merged as T;
}

const STROKE_KEYS = ["color", "width", "dash", "cap", "join", "gap"] as const;

export function strokeDifferences(strokes: readonly (StudioStroke | null)[]): Set<string> {
  const present = strokes.filter((stroke): stroke is StudioStroke => stroke !== null);
  const differences = new Set<string>();
  if (present.length && present.length !== strokes.length) differences.add("presence");
  const valueOf = (stroke: StudioStroke, key: (typeof STROKE_KEYS)[number]) => (key === "cap" ? strokeCap(stroke) : key === "join" ? strokeJoin(stroke) : key === "gap" ? (stroke.gap ?? 1) : stroke[key]);
  for (const key of STROKE_KEYS) if (sharedValue(present.map((stroke) => valueOf(stroke, key))).mixed) differences.add(key);
  return differences;
}

export function isFillable(element: StudioElement): element is FillableElement {
  return element.kind === "shape" && !isLineShape(element.shape);
}

export function isLineElement(element: StudioElement): element is StudioShapeElement {
  return element.kind === "shape" && isLineShape(element.shape);
}

export function isCornerable(element: StudioElement): element is StudioShapeElement {
  return element.kind === "shape" && element.shape === "rect";
}

export function cornersOf(element: StudioShapeElement): StudioCornerRadii {
  return element.corners ?? [element.cornerRadius, element.cornerRadius, element.cornerRadius, element.cornerRadius];
}

export function withCorner(element: StudioShapeElement, index: number, radius: number): StudioCornerRadii {
  const corners = [...cornersOf(element)] as StudioCornerRadii;
  corners[index] = radius;
  return corners;
}

export function isShadowable(element: StudioElement): element is ShadowableElement {
  return element.kind !== "text";
}

const SHADOW_KEYS = ["color", "opacity", "x", "y", "blur"] as const;

export function shadowDifferences(shadows: readonly (StudioDropShadow | null)[]): Set<string> {
  const present = shadows.filter((shadow): shadow is StudioDropShadow => shadow !== null);
  const differences = new Set<string>();
  if (present.length && present.length !== shadows.length) differences.add("presence");
  for (const key of SHADOW_KEYS) if (sharedValue(present.map((shadow) => shadow[key])).mixed) differences.add(key);
  return differences;
}

export function isStrokable(element: StudioElement): element is StrokableElement {
  return element.kind === "shape" || element.kind === "image";
}

export function isRoundable(element: StudioElement): element is RoundableElement {
  if (element.kind === "shape") return element.shape === "rect" || element.shape === "speech";
  return element.kind === "image" && element.mask === "rounded";
}

export function maxCornerRadius(elements: readonly StudioElement[]): number {
  return Math.max(0, Math.round(Math.min(...elements.map((element) => Math.min(element.width, element.height) / 2))));
}

export function selectionFrame(elements: StudioElement[]): Bounds | null {
  return boundsOf(elements);
}

export function moveSelectionTo(page: StudioPage, ids: readonly string[], x: number, y: number): StudioPage {
  const frame = selectionFrame(page.elements.filter((element) => ids.includes(element.id)));
  if (!frame) return page;
  return moveElements(page, ids, x - frame.x, y - frame.y);
}

export function resizeSelectionTo(page: StudioPage, ids: readonly string[], width: number, height: number): StudioPage {
  const chosen = new Set(ids);
  const frame = selectionFrame(page.elements.filter((element) => chosen.has(element.id)));
  if (!frame) return page;
  const target = { x: frame.x, y: frame.y, width: Math.max(MIN_SIDE, width), height: Math.max(MIN_SIDE, height) };
  const scaled = new Map(scaleElements(page.elements.filter((element) => chosen.has(element.id)), frame, target).map((element) => [element.id, element]));
  return { ...page, elements: page.elements.map((element) => scaled.get(element.id) ?? element) };
}
