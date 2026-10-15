import { useDocumentStore } from "@/shared/store/documentStore";
import type { Stroke, StrokePoint } from "@/shared/store/presentationStore";

const CM_PER_PT = 2.54 / 72;
const MM_PER_CM = 10;
const TICK_MIN_PX = 6;
const TICK_PER_WIDTH = 3;
const LABEL_FONT_RATIO = 0.016;
const LABEL_FONT_MIN_PX = 11;
const LABEL_GAP_RATIO = 0.4;

export type Segment = [StrokePoint, StrokePoint];

export type MeasureLayout = { ticks: Segment[]; label: string | null; labelCenter: StrokePoint; labelAngle: number; fontPx: number };

function locale(): string {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang || "en";
}

export function formatLength(points: number, language = locale()): string {
  const cm = points * CM_PER_PT;
  if (cm < 1) return new Intl.NumberFormat(language, { style: "unit", unit: "millimeter", maximumFractionDigits: 0 }).format(cm * MM_PER_CM);
  return new Intl.NumberFormat(language, { style: "unit", unit: "centimeter", maximumFractionDigits: 1 }).format(cm);
}

export function measureLengthPt(stroke: Stroke): number | null {
  const [start, end] = stroke.points;
  if (!stroke.pageSize || !start || !end) return null;
  return Math.hypot((end.x - start.x) * stroke.pageSize.width, (end.y - start.y) * stroke.pageSize.height);
}

export function measureLabel(stroke: Stroke, language?: string): string | null {
  const length = measureLengthPt(stroke);
  return length === null ? null : formatLength(length, language);
}

export function measureFontPx(width: number): number {
  return Math.max(LABEL_FONT_MIN_PX, width * LABEL_FONT_RATIO);
}

export function measureLayout(stroke: Stroke, width: number, height: number, language?: string): MeasureLayout | null {
  const [startPoint, endPoint] = stroke.points;
  if (!startPoint || !endPoint) return null;
  const start = { x: startPoint.x * width, y: startPoint.y * height };
  const end = { x: endPoint.x * width, y: endPoint.y * height };
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const angle = length > 0 ? Math.atan2(end.y - start.y, end.x - start.x) : 0;
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const half = Math.max(TICK_MIN_PX, stroke.width * width * TICK_PER_WIDTH);
  const tick = (point: StrokePoint): Segment => [
    { x: point.x - normal.x * half, y: point.y - normal.y * half },
    { x: point.x + normal.x * half, y: point.y + normal.y * half },
  ];
  const fontPx = measureFontPx(width);
  const upright = angle > Math.PI / 2 || angle <= -Math.PI / 2 ? angle + Math.PI : angle;
  const lift = half + fontPx * (0.5 + LABEL_GAP_RATIO);
  const side = Math.cos(upright - angle) > 0 ? -1 : 1;
  const labelCenter = { x: (start.x + end.x) / 2 + normal.x * lift * side, y: (start.y + end.y) / 2 + normal.y * lift * side };
  return { ticks: [tick(start), tick(end)], label: measureLabel(stroke, language), labelCenter, labelAngle: upright, fontPx };
}

export function visiblePageSize(pageIndex: number, surface: { width: number; height: number }): { width: number; height: number } | undefined {
  const { activeId, documents } = useDocumentStore.getState();
  const size = activeId ? documents[activeId]?.info?.pageSizes.at(pageIndex) : undefined;
  if (!size) return undefined;
  const turned = surface.width > surface.height !== size.width > size.height && size.width !== size.height;
  return turned ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}
