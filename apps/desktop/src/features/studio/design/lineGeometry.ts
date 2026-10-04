import type { StudioElement } from "@/types/studio";
import { MIN_SIDE, normalizeAngle, ROTATION_STEP, type Vector } from "./transform";

export type LineEnd = "start" | "end";

export type LinePatch = { x: number; y: number; width: number; rotation: number };

export function lineEndpoints(element: Pick<StudioElement, "x" | "y" | "width" | "height" | "rotation">): Record<LineEnd, Vector> {
  const radians = (element.rotation * Math.PI) / 180;
  const half = { x: (Math.cos(radians) * element.width) / 2, y: (Math.sin(radians) * element.width) / 2 };
  const centre = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  return { start: { x: centre.x - half.x, y: centre.y - half.y }, end: { x: centre.x + half.x, y: centre.y + half.y } };
}

export function stepLineAngle(fixed: Vector, point: Vector, step = ROTATION_STEP): Vector {
  const length = Math.hypot(point.x - fixed.x, point.y - fixed.y);
  const angle = Math.round(Math.atan2(point.y - fixed.y, point.x - fixed.x) / ((step * Math.PI) / 180)) * ((step * Math.PI) / 180);
  return { x: fixed.x + Math.cos(angle) * length, y: fixed.y + Math.sin(angle) * length };
}

export function lineBetween(start: Vector, end: Vector, height: number): LinePatch {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const rotation = length > 0 ? normalizeAngle(Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 1000) / 1000) : 0;
  const width = Math.max(MIN_SIDE, length);
  const centre = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, rotation };
}

export function moveLineEnd(element: Pick<StudioElement, "x" | "y" | "width" | "height" | "rotation">, which: LineEnd, point: Vector, options: { step?: boolean } = {}): LinePatch {
  const ends = lineEndpoints(element);
  const fixed = which === "start" ? ends.end : ends.start;
  const moved = options.step ? stepLineAngle(fixed, point) : point;
  return which === "start" ? lineBetween(moved, fixed, element.height) : lineBetween(fixed, moved, element.height);
}
