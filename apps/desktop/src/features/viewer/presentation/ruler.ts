import { usePresentationStore, type RulerState } from "@/shared/store/presentationStore";
import { visiblePageSize } from "./measure";
import type { PageRect } from "./usePageRects";

const PT_PER_CM = 72 / 2.54;
const MIN_LENGTH_CM = 10;
const BAND_RATIO = 0.07;
const MIN_BAND_PX = 40;
const FALLBACK_WIDTH_PT = 612;
const SNAP_STEP_DEG = 15;
const SOFT_SNAP_STEP_DEG = 45;
const SOFT_SNAP_REACH_DEG = 3;
export const RULER_SNAP_REACH_PX = 18;

export type Vector = { x: number; y: number };

export type RulerEdge = { origin: Vector; direction: Vector; normal: Vector; angle: number; length: number; lengthCm: number; pxPerCm: number; band: number };

export function rulerLengthCm(pageWidthPt: number): number {
  return Math.max(MIN_LENGTH_CM, Math.ceil(pageWidthPt / PT_PER_CM));
}

export function rulerEdge(rects: readonly PageRect[], ruler: RulerState | null): RulerEdge | null {
  if (!ruler || ruler.pageWidthPt <= 0) return null;
  const rect = rects.find((entry) => entry.pageIndex === ruler.pageIndex);
  if (!rect || rect.width <= 0) return null;
  const pxPerCm = (rect.width / ruler.pageWidthPt) * PT_PER_CM;
  const radians = (ruler.angle * Math.PI) / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const lengthCm = rulerLengthCm(ruler.pageWidthPt);
  return {
    origin: { x: rect.left + ruler.x * rect.width, y: rect.top + ruler.y * rect.height },
    direction,
    normal: { x: -direction.y, y: direction.x },
    angle: ruler.angle,
    length: lengthCm * pxPerCm,
    lengthCm,
    pxPerCm,
    band: Math.max(MIN_BAND_PX, rect.width * BAND_RATIO),
  };
}

function along(edge: RulerEdge, point: Vector): { t: number; offset: number } {
  const dx = point.x - edge.origin.x;
  const dy = point.y - edge.origin.y;
  return { t: dx * edge.direction.x + dy * edge.direction.y, offset: dx * edge.normal.x + dy * edge.normal.y };
}

export function nearRulerEdge(edge: RulerEdge, point: Vector, reach = RULER_SNAP_REACH_PX): boolean {
  const { t, offset } = along(edge, point);
  return offset <= reach / 3 && offset >= -reach && t >= -reach && t <= edge.length + reach;
}

export function snapToRuler(edge: RulerEdge, point: Vector, clearance: number): Vector {
  const { t } = along(edge, point);
  return { x: edge.origin.x + edge.direction.x * t - edge.normal.x * clearance, y: edge.origin.y + edge.direction.y * t - edge.normal.y * clearance };
}

export function normalizeAngle(angle: number): number {
  const wrapped = ((((angle + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

export function snapAngle(angle: number, stepped: boolean): number {
  const normalized = normalizeAngle(angle);
  if (stepped) return normalizeAngle(Math.round(normalized / SNAP_STEP_DEG) * SNAP_STEP_DEG);
  const nearest = Math.round(normalized / SOFT_SNAP_STEP_DEG) * SOFT_SNAP_STEP_DEG;
  return Math.abs(normalized - nearest) <= SOFT_SNAP_REACH_DEG ? normalizeAngle(nearest) : Math.round(normalized * 10) / 10;
}

export function rotateRuler(ruler: RulerState, delta: number): RulerState {
  return { ...ruler, angle: normalizeAngle(Math.round((ruler.angle + delta) / SNAP_STEP_DEG) * SNAP_STEP_DEG) };
}

function pageSurface(pageIndex: number): { width: number; height: number } | null {
  if (typeof document === "undefined") return null;
  const node = document.querySelector(`[data-page-index="${pageIndex}"]`);
  const box = node?.getBoundingClientRect();
  return box && box.width > 0 && box.height > 0 ? { width: box.width, height: box.height } : null;
}

export function toggleRulerOn(pageIndex: number): void {
  const surface = pageSurface(pageIndex);
  const size = surface ? visiblePageSize(pageIndex, surface) : undefined;
  usePresentationStore.getState().toggleRuler(pageIndex, size?.width ?? FALLBACK_WIDTH_PT);
}
