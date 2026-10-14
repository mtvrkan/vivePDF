import type { PresentationTool, Stroke } from "@/shared/store/presentationStore";
import { nearestPageRect, type PageRect } from "./usePageRects";

export type LivePoint = { pageIndex: number; x: number; y: number };

export type LiveSignal = {
  tool: PresentationTool;
  pageWidth: number;
  pointer: LivePoint | null;
  laserPath: LivePoint[] | null;
  activeStroke: { pageIndex: number; stroke: Stroke } | null;
};

export function toLivePoint(rects: PageRect[], x: number, y: number): LivePoint | null {
  const rect = nearestPageRect(rects, x, y);
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return { pageIndex: rect.pageIndex, x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
}

export function fromLivePoint(rects: PageRect[], point: LivePoint): { x: number; y: number } | null {
  const rect = rects.find((entry) => entry.pageIndex === point.pageIndex);
  if (!rect) return null;
  return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height };
}

export function liveScale(rects: PageRect[], signal: Pick<LiveSignal, "pageWidth" | "pointer">): number {
  const pageIndex = signal.pointer?.pageIndex;
  const rect = (pageIndex !== undefined ? rects.find((entry) => entry.pageIndex === pageIndex) : undefined) ?? rects[0];
  if (!rect || signal.pageWidth <= 0) return 1;
  return rect.width / signal.pageWidth;
}
