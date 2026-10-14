import type { DrawingAsset, Stroke, StrokePoint } from "@/shared/store/presentationStore";
import { makeDrawingId } from "./drawingGestures";

export const PLACE_REFERENCE_PT = 612;
const MIN_WIDTH = 0.06;
const MAX_WIDTH = 0.7;
const MAX_HEIGHT = 0.9;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type SurfaceBox = { width: number; height: number };

export function placedDrawing(asset: Pick<DrawingAsset, "width" | "height">, assetId: string, point: StrokePoint, surface: SurfaceBox, id = makeDrawingId("drawing")): Stroke | null {
  if (asset.width <= 0 || asset.height <= 0 || surface.width <= 0 || surface.height <= 0) return null;
  let width = clamp(asset.width / PLACE_REFERENCE_PT, MIN_WIDTH, MAX_WIDTH);
  let height = (width * surface.width * asset.height) / (asset.width * surface.height);
  if (height > MAX_HEIGHT) {
    width *= MAX_HEIGHT / height;
    height = MAX_HEIGHT;
  }
  const anchor = { x: clamp(point.x - width / 2, 0, 1 - width), y: clamp(point.y - height / 2, 0, 1 - height) };
  return { id, tool: "drawing", color: "#000000", width: 0, points: [anchor], size: { width, height }, asset: assetId };
}

export function resizedDrawing(stroke: Stroke, assetId: string, sx: number, sy: number): Stroke {
  const anchor = stroke.points[0] ?? { x: 0, y: 0 };
  const size = stroke.size ?? { width: 0, height: 0 };
  const width = size.width * sx;
  const height = size.height * sy;
  const fit = Math.min(1, width > 0 ? (1 - anchor.x) / width : 1, height > 0 ? (1 - anchor.y) / height : 1);
  const shrink = fit > 0 ? fit : 1;
  return { ...stroke, asset: assetId, size: { width: width * shrink, height: height * shrink } };
}
