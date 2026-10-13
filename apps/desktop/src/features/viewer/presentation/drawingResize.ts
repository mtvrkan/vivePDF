import type { DrawingBounds } from "@/shared/lib/drawingGeometry";
import type { StrokePoint } from "@/shared/store/presentationStore";

export type ResizeCorner = "nw" | "ne" | "sw" | "se";
export type ResizeArea = { width: number; height: number };
export type DrawingResize = { anchor: StrokePoint; sx: number; sy: number };

export const RESIZE_CORNERS: readonly ResizeCorner[] = ["nw", "ne", "sw", "se"];
export const RESIZE_STEP = 1.15;

const MIN_SIZE_PX = 12;
const FLAT_PX = 2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function cornerPoint(extent: DrawingBounds, corner: ResizeCorner): StrokePoint {
  return { x: corner.endsWith("e") ? extent.right : extent.left, y: corner.startsWith("s") ? extent.bottom : extent.top };
}

export function cornerResize(extent: DrawingBounds, corner: ResizeCorner, pointer: StrokePoint, keepRatio: boolean, area: ResizeArea): DrawingResize | null {
  const east = corner.endsWith("e");
  const south = corner.startsWith("s");
  const anchor = { x: east ? extent.left : extent.right, y: south ? extent.top : extent.bottom };
  const width = extent.right - extent.left;
  const height = extent.bottom - extent.top;
  const flatX = width < FLAT_PX;
  const flatY = height < FLAT_PX;
  if (flatX && flatY) return null;
  const roomX = east ? area.width - anchor.x : anchor.x;
  const roomY = south ? area.height - anchor.y : anchor.y;
  const reachX = clamp(east ? pointer.x - anchor.x : anchor.x - pointer.x, Math.min(MIN_SIZE_PX, width), Math.max(width, roomX));
  const reachY = clamp(south ? pointer.y - anchor.y : anchor.y - pointer.y, Math.min(MIN_SIZE_PX, height), Math.max(height, roomY));
  let sx = flatX ? 0 : reachX / width;
  let sy = flatY ? 0 : reachY / height;
  if (flatX) sx = sy;
  if (flatY) sy = sx;
  if (keepRatio || flatX || flatY) {
    const caps = [flatX ? Infinity : Math.max(1, roomX / width), flatY ? Infinity : Math.max(1, roomY / height)];
    const k = Math.min(Math.max(sx, sy), ...caps);
    sx = k;
    sy = k;
  }
  return { anchor, sx, sy };
}

export function stepResize(extent: DrawingBounds, factor: number, area: ResizeArea): DrawingResize | null {
  const width = extent.right - extent.left;
  const height = extent.bottom - extent.top;
  const longest = Math.max(width, height);
  if (longest < FLAT_PX) return null;
  const anchor = { x: (extent.left + extent.right) / 2, y: (extent.top + extent.bottom) / 2 };
  const caps = [
    width >= FLAT_PX ? Math.min(anchor.x, area.width - anchor.x) / (width / 2) : Infinity,
    height >= FLAT_PX ? Math.min(anchor.y, area.height - anchor.y) / (height / 2) : Infinity,
  ];
  const k = clamp(factor, Math.min(1, MIN_SIZE_PX / longest), Math.max(1, Math.min(...caps)));
  if (Math.abs(k - 1) < 1e-3) return null;
  return { anchor, sx: k, sy: k };
}
