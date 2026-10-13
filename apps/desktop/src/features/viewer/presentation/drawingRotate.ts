import { drawingExtent, drawingOutline, translateDrawing, type DrawingScale } from "@/shared/lib/drawingGeometry";
import type { Stroke, StrokePoint } from "@/shared/store/presentationStore";
import { makeDrawingId } from "./drawingGestures";

export const QUARTER_TURN = Math.PI / 2;
export const ROTATE_SNAP = Math.PI / 12;
export const DUPLICATE_OFFSET_PX = 16;

const TURN_EPSILON = 1e-6;

export function canRotate(stroke: Stroke): boolean {
  return stroke.tool !== "text" && stroke.points.length > 0;
}

export function snapAngle(angle: number, step = ROTATE_SNAP): number {
  return Math.round(angle / step) * step;
}

function isQuarterTurn(angle: number): boolean {
  const turns = angle / QUARTER_TURN;
  return Math.abs(turns - Math.round(turns)) < TURN_EPSILON;
}

export function rotateDrawing(stroke: Stroke, angle: number, scale: DrawingScale): Stroke {
  if (!canRotate(stroke) || Math.abs(angle) < TURN_EPSILON) return stroke;
  const extent = drawingExtent(stroke, scale);
  const cx = (extent.left + extent.right) / 2;
  const cy = (extent.top + extent.bottom) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turn = (point: StrokePoint): StrokePoint => {
    const x = point.x * scale.x - cx;
    const y = point.y * scale.y - cy;
    return { x: (cx + x * cos - y * sin) / scale.x, y: (cy + x * sin + y * cos) / scale.y };
  };
  const boxed = stroke.tool === "rect" || stroke.tool === "ellipse";
  if (!boxed || isQuarterTurn(angle)) return { ...stroke, points: stroke.points.map(turn) };
  return { ...stroke, tool: "pen", points: drawingOutline(stroke)[0].map(turn) };
}

export function duplicateDrawing(stroke: Stroke, scale: DrawingScale): Stroke {
  const copy = translateDrawing(stroke, DUPLICATE_OFFSET_PX / scale.x, DUPLICATE_OFFSET_PX / scale.y);
  return { ...copy, id: makeDrawingId(stroke.tool === "text" ? "text" : undefined) };
}
