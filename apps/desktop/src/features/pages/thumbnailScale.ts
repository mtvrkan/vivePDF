import type { PageSize } from "@/types";

const RENDER_SCALES = [0.15, 0.2, 0.25, 0.35, 0.45, 0.6, 0.8, 1.1, 1.5];

function scaleForWidth(width: number): number {
  if (width <= 160) return 0.25;
  if (width <= 260) return 0.45;
  if (width <= 600) return 0.8;
  return 1.5;
}

export function thumbnailScale(box: { width: number; height: number }, page: Pick<PageSize, "width" | "height"> | null, pixelRatio: number): number {
  if (!page || page.width <= 0 || page.height <= 0) return scaleForWidth(box.width);
  const needed = Math.min(box.width / page.width, box.height / page.height) * Math.max(1, pixelRatio);
  return RENDER_SCALES.find((scale) => scale >= needed) ?? RENDER_SCALES[RENDER_SCALES.length - 1];
}
