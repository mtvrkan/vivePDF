import type { Stroke, StrokePoint } from "@/shared/store/presentationStore";

const ELLIPSE_SEGMENTS = 48;

export type DrawingScale = { x: number; y: number };
export type DrawingBounds = { left: number; top: number; right: number; bottom: number };

const UNIT_SCALE: DrawingScale = { x: 1, y: 1 };

export function isFreehand(stroke: Stroke): boolean {
  return stroke.tool === "pen" || stroke.tool === "highlighter";
}

export function distanceToSegment(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function corners(stroke: Stroke): { x0: number; y0: number; x1: number; y1: number } {
  const [start, end = start] = stroke.points;
  return { x0: Math.min(start.x, end.x), y0: Math.min(start.y, end.y), x1: Math.max(start.x, end.x), y1: Math.max(start.y, end.y) };
}

export function ellipsePoints(stroke: Stroke): StrokePoint[] {
  const { x0, y0, x1, y1 } = corners(stroke);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  return Array.from({ length: ELLIPSE_SEGMENTS + 1 }, (_, index) => {
    const angle = (index / ELLIPSE_SEGMENTS) * Math.PI * 2;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

export function drawingOutline(stroke: Stroke): StrokePoint[][] {
  if (isFreehand(stroke)) return [stroke.points];
  if (stroke.tool === "line" || stroke.tool === "arrow") return stroke.points.length > 1 ? [stroke.points.slice(0, 2)] : [];
  if (stroke.tool === "rect") {
    const { x0, y0, x1, y1 } = corners(stroke);
    return [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]];
  }
  if (stroke.tool === "ellipse") return [ellipsePoints(stroke)];
  return [];
}

export function drawingBounds(stroke: Stroke, scale: DrawingScale = UNIT_SCALE): DrawingBounds {
  if (stroke.tool === "text") {
    const anchor = stroke.points[0] ?? { x: 0, y: 0 };
    const size = stroke.size ?? { width: 0, height: 0 };
    return { left: anchor.x * scale.x, top: anchor.y * scale.y, right: (anchor.x + size.width) * scale.x, bottom: (anchor.y + size.height) * scale.y };
  }
  const pad = (stroke.width * scale.x) / 2;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of drawingOutline(stroke).flat().concat(stroke.points)) {
    left = Math.min(left, point.x * scale.x);
    top = Math.min(top, point.y * scale.y);
    right = Math.max(right, point.x * scale.x);
    bottom = Math.max(bottom, point.y * scale.y);
  }
  if (!Number.isFinite(left)) return { left: 0, top: 0, right: 0, bottom: 0 };
  return { left: left - pad, top: top - pad, right: right + pad, bottom: bottom + pad };
}

function insideBounds(bounds: DrawingBounds, point: StrokePoint, tolerance: number): boolean {
  return point.x >= bounds.left - tolerance && point.x <= bounds.right + tolerance && point.y >= bounds.top - tolerance && point.y <= bounds.bottom + tolerance;
}

function insideEllipse(stroke: Stroke, point: StrokePoint, scale: DrawingScale): boolean {
  const { x0, y0, x1, y1 } = corners(stroke);
  const rx = ((x1 - x0) / 2) * scale.x;
  const ry = ((y1 - y0) / 2) * scale.y;
  if (rx <= 0 || ry <= 0) return false;
  const dx = point.x - ((x0 + x1) / 2) * scale.x;
  const dy = point.y - ((y0 + y1) / 2) * scale.y;
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}

export function hitsDrawing(stroke: Stroke, point: StrokePoint, tolerance: number, { scale = UNIT_SCALE, filled = false }: { scale?: DrawingScale; filled?: boolean } = {}): boolean {
  const scaledPoint = { x: point.x * scale.x, y: point.y * scale.y };
  if (stroke.tool === "text") return insideBounds(drawingBounds(stroke, scale), scaledPoint, tolerance);
  if (filled && stroke.tool === "rect" && insideBounds(drawingBounds(stroke, scale), scaledPoint, 0)) return true;
  if (filled && stroke.tool === "ellipse" && insideEllipse(stroke, scaledPoint, scale)) return true;
  const threshold = tolerance + (stroke.width * scale.x) / 2;
  for (const line of drawingOutline(stroke)) {
    const points = line.map((entry) => ({ x: entry.x * scale.x, y: entry.y * scale.y }));
    if (points.length === 1 && Math.hypot(points[0].x - scaledPoint.x, points[0].y - scaledPoint.y) <= threshold) return true;
    for (let i = 0; i < points.length - 1; i += 1) {
      if (distanceToSegment(scaledPoint, points[i], points[i + 1]) <= threshold) return true;
    }
  }
  return false;
}

export function translateDrawing(stroke: Stroke, dx: number, dy: number): Stroke {
  return { ...stroke, points: stroke.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
}

export function topDrawingAt(strokes: readonly Stroke[], point: StrokePoint, tolerance: number, scale: DrawingScale): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    if (hitsDrawing(strokes[i], point, tolerance, { scale, filled: true })) return strokes[i];
  }
  return null;
}
