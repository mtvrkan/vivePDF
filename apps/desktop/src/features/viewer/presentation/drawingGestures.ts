import { isFreehand } from "@/shared/lib/drawingGeometry";
import type { ShapeKind, Stroke, StrokePoint } from "@/shared/store/presentationStore";

const SNAP_ANGLE = Math.PI / 4;
const MIN_SHAPE_PX = 3;

export type DrawStyle = {
  tool: "pen" | "highlighter" | "shape";
  color: string;
  penWidth: number;
  highlighterWidth: number;
  penOpacity: number;
  shapeKind: ShapeKind;
};

export type SurfaceSize = { width: number; height: number };

export function makeDrawingId(prefix = "stroke"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function beginDrawing(style: DrawStyle, point: StrokePoint, surface: SurfaceSize, id = makeDrawingId()): Stroke {
  if (style.tool === "highlighter") return { id, tool: "highlighter", color: style.color, width: style.highlighterWidth / surface.width, points: [point] };
  const base = { id, color: style.color, width: style.penWidth / surface.width, ...(style.penOpacity < 1 ? { opacity: style.penOpacity } : {}) };
  if (style.tool === "pen") return { ...base, tool: "pen", points: [point] };
  return { ...base, tool: style.shapeKind, points: [point, point] };
}

function constrainedEnd(kind: Stroke["tool"], start: StrokePoint, point: StrokePoint, surface: SurfaceSize): StrokePoint {
  const dx = (point.x - start.x) * surface.width;
  const dy = (point.y - start.y) * surface.height;
  if (kind === "line" || kind === "arrow") {
    const length = Math.hypot(dx, dy);
    const angle = Math.round(Math.atan2(dy, dx) / SNAP_ANGLE) * SNAP_ANGLE;
    return { x: start.x + (Math.cos(angle) * length) / surface.width, y: start.y + (Math.sin(angle) * length) / surface.height };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + (Math.sign(dx) * side) / surface.width, y: start.y + (Math.sign(dy) * side) / surface.height };
}

export function extendDrawing(stroke: Stroke, point: StrokePoint, surface: SurfaceSize, constrain = false): Stroke {
  if (isFreehand(stroke)) return { ...stroke, points: [...stroke.points, point] };
  const start = stroke.points[0];
  return { ...stroke, points: [start, constrain ? constrainedEnd(stroke.tool, start, point, surface) : point] };
}

export function isDrawingKept(stroke: Stroke, surface: SurfaceSize): boolean {
  if (isFreehand(stroke)) return stroke.points.length > 1;
  const [start, end] = stroke.points;
  if (!end) return false;
  return Math.hypot((end.x - start.x) * surface.width, (end.y - start.y) * surface.height) >= MIN_SHAPE_PX;
}
