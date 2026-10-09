import type { StudioBleedEdges, StudioElement, StudioPage, StudioRenderBox, StudioRenderFill, StudioStroke } from "@/types/studio";

export const POINTS_PER_MM = 72 / 25.4;
export const DEFAULT_BLEED_MM = 3;
export const MAX_BLEED_MM = 10;
const EDGE_TOLERANCE = 0.5;

export function millimetresToPoints(millimetres: number): number {
  return millimetres * POINTS_PER_MM;
}

function unstroked(stroke: StudioStroke | null): boolean {
  return stroke === null || stroke.width <= 0;
}

function reachesEdges(element: StudioElement): boolean {
  if (element.rotation % 360 !== 0) return false;
  if (element.kind === "image") return element.mask === "none" && element.fit !== "contain" && unstroked(element.stroke);
  if (element.kind !== "shape" || element.shape !== "rect") return false;
  return unstroked(element.stroke) && element.cornerRadius <= 0 && (element.corners ?? []).every((radius) => radius <= 0);
}

export function bleedEdges(before: StudioRenderBox, after: StudioRenderBox): StudioBleedEdges {
  return { left: before.x - after.x, top: before.y - after.y, right: after.x + after.width - (before.x + before.width), bottom: after.y + after.height - (before.y + before.height) };
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
