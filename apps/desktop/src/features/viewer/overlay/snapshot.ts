import type { Rect } from "@embedpdf/models";
import { normalizeArea, type PageArea } from "./areaText";

export const SNAPSHOT_MIN_SCALE = 2;
export const SNAPSHOT_MAX_PIXELS = 6000;

export function snapshotRect(area: PageArea): Rect {
  const box = normalizeArea(area);
  return { origin: { x: box.x0, y: box.y0 }, size: { width: box.x1 - box.x0, height: box.y1 - box.y0 } };
}

export function snapshotScale(zoom: number, rect: Rect): number {
  const wanted = Math.max(SNAPSHOT_MIN_SCALE, Number.isFinite(zoom) ? zoom : 1);
  const longest = Math.max(rect.size.width, rect.size.height, 1);
  return Math.min(wanted, SNAPSHOT_MAX_PIXELS / longest);
}
