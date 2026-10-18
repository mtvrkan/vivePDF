import { drawingBounds, drawingOutline, isBoxed } from "@/shared/lib/drawingGeometry";
import type { Stroke, StrokePoint } from "@/shared/store/presentationStore";

export type ViewSize = { width: number; height: number };
export type NormalRect = { left: number; top: number; right: number; bottom: number };

export function rectFromPoints(a: StrokePoint, b: StrokePoint): NormalRect {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

function inside(point: StrokePoint, rect: NormalRect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function segmentCrossesRect(a: StrokePoint, b: StrokePoint, rect: NormalRect): boolean {
  let enter = 0;
  let leave = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: Array<[number, number]> = [
    [-dx, a.x - rect.left],
    [dx, rect.right - a.x],
    [-dy, a.y - rect.top],
    [dy, rect.bottom - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return false;
  }
  return true;
}

export function strokeTouchesRect(stroke: Stroke, rect: NormalRect): boolean {
  if (isBoxed(stroke)) {
    const box = drawingBounds(stroke);
    return box.left <= rect.right && box.right >= rect.left && box.top <= rect.bottom && box.bottom >= rect.top;
  }
  for (const line of drawingOutline(stroke)) {
    if (line.some((point) => inside(point, rect))) return true;
    for (let i = 0; i < line.length - 1; i += 1) {
      if (segmentCrossesRect(line[i], line[i + 1], rect)) return true;
    }
  }
  return false;
}

export function strokesInRect(strokes: Stroke[], rect: NormalRect): string[] {
  return strokes.filter((stroke) => strokeTouchesRect(stroke, rect)).map((stroke) => stroke.id);
}

export function selectionBounds(strokes: Stroke[], ids: readonly string[], size: ViewSize): NormalRect | null {
  const wanted = new Set(ids);
  const scale = { x: size.width, y: size.height };
  const bounds: NormalRect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const stroke of strokes) {
    if (!wanted.has(stroke.id)) continue;
    const box = drawingBounds(stroke, scale);
    bounds.left = Math.min(bounds.left, box.left / size.width);
    bounds.top = Math.min(bounds.top, box.top / size.height);
    bounds.right = Math.max(bounds.right, box.right / size.width);
    bounds.bottom = Math.max(bounds.bottom, box.bottom / size.height);
  }
  return Number.isFinite(bounds.left) ? bounds : null;
}

export function clampSelectionOffset(bounds: NormalRect, dx: number, dy: number): StrokePoint {
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  return { x: Math.min(1 - centerX, Math.max(-centerX, dx)), y: Math.min(1 - centerY, Math.max(-centerY, dy)) };
}

export function translateStrokes(strokes: Stroke[], ids: readonly string[], dx: number, dy: number): Stroke[] {
  if (ids.length === 0 || (dx === 0 && dy === 0)) return strokes;
  const wanted = new Set(ids);
  return strokes.map((stroke) => (wanted.has(stroke.id) ? { ...stroke, points: stroke.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) } : stroke));
}

export function removeStrokes(strokes: Stroke[], ids: readonly string[]): Stroke[] {
  if (ids.length === 0) return strokes;
  const doomed = new Set(ids);
  const kept = strokes.filter((stroke) => !doomed.has(stroke.id));
  return kept.length === strokes.length ? strokes : kept;
}

export function mergeSelection(current: readonly string[], picked: readonly string[], additive: boolean): string[] {
  if (!additive) return [...picked];
  const merged = new Set(current);
  for (const id of picked) merged.add(id);
  return [...merged];
}

export function toggleInSelection(current: readonly string[], id: string): string[] {
  return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
}
