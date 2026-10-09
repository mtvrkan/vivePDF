import type { StudioElement, StudioPage, StudioRenderFill } from "@/types/studio";

export const POINTS_PER_MM = 72 / 25.4;
export const DEFAULT_BLEED_MM = 3;
export const MAX_BLEED_MM = 10;
const EDGE_TOLERANCE = 0.5;

export function millimetresToPoints(millimetres: number): number {
  return millimetres * POINTS_PER_MM;
}

function reachesEdges(element: StudioElement): boolean {
  if (element.rotation % 360 !== 0) return false;
  return element.kind === "image" || (element.kind === "shape" && element.shape === "rect");
}

export function bleedElement(element: StudioElement, page: Pick<StudioPage, "width" | "height">, bleed: number): StudioElement {
  if (bleed <= 0 || !reachesEdges(element)) return element;
  const right = element.x + element.width;
  const bottom = element.y + element.height;
  const left = element.x <= EDGE_TOLERANCE ? Math.min(element.x, -bleed) : element.x;
  const top = element.y <= EDGE_TOLERANCE ? Math.min(element.y, -bleed) : element.y;
  const farRight = right >= page.width - EDGE_TOLERANCE ? Math.max(right, page.width + bleed) : right;
  const farBottom = bottom >= page.height - EDGE_TOLERANCE ? Math.max(bottom, page.height + bleed) : bottom;
  if (left === element.x && top === element.y && farRight === right && farBottom === bottom) return element;
  return { ...element, x: left, y: top, width: farRight - left, height: farBottom - top };
}

export function bleedPage(page: StudioPage, bleed: number): StudioPage {
  if (bleed <= 0) return page;
  return { ...page, elements: page.elements.map((element) => bleedElement(element, page, bleed)) };
}

export function shiftFill(fill: StudioRenderFill, dx: number, dy: number): StudioRenderFill {
  switch (fill.type) {
    case "solid":
      return fill;
    case "linear":
      return { ...fill, x1: fill.x1 + dx, y1: fill.y1 + dy, x2: fill.x2 + dx, y2: fill.y2 + dy };
    case "radial":
      return { ...fill, cx: fill.cx + dx, cy: fill.cy + dy };
  }
}
