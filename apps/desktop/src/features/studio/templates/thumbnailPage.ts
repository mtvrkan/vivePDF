import type { StudioElement, StudioImageElement, StudioPage, StudioVectorElement } from "@/types/studio";
import { ellipse, roundedRect } from "../model/shapes";

const PLACEHOLDER_FILL = "#e6e8ec";
const PLACEHOLDER_INK = "#a3a9b4";
const PLACEHOLDER_ICON_MAX = 48;
const MAX_SIDE = 640;
const HEADROOM = 1.25;

function solidPath(d: string, color: string) {
  return { d, fill: { type: "solid" as const, color }, stroke: null, evenOdd: false, opacity: 1 };
}

export function placeholderOf(element: StudioImageElement): StudioVectorElement {
  const { width, height } = element;
  const outline = element.mask === "circle" ? ellipse(width / 2, height / 2, width / 2, height / 2) : roundedRect(0, 0, width, height, element.mask === "rounded" ? element.cornerRadius : 0);
  const side = Math.min(Math.min(width, height) / 3, PLACEHOLDER_ICON_MAX);
  const cx = width / 2;
  const cy = height / 2;
  const base = cy + side / 2;
  const peak = `M${cx - side / 2} ${base} L${cx - side / 6} ${cy - side / 10} L${cx + side / 6} ${base} Z`;
  const hill = `M${cx - side / 10} ${base} L${cx + side / 5} ${cy + side / 8} L${cx + side / 2} ${base} Z`;
  const sun = ellipse(cx + side / 4, cy - side / 4, side / 9, side / 9);
  return {
    id: element.id,
    name: element.name,
    x: element.x,
    y: element.y,
    width,
    height,
    rotation: element.rotation,
    opacity: element.opacity,
    locked: element.locked,
    hidden: element.hidden,
    groupId: element.groupId,
    kind: "vector",
    viewWidth: width,
    viewHeight: height,
    paths: [solidPath(outline, PLACEHOLDER_FILL), solidPath(peak, PLACEHOLDER_INK), solidPath(hill, PLACEHOLDER_INK), solidPath(sun, PLACEHOLDER_INK)],
    dropShadow: element.dropShadow,
  };
}

export function thumbnailPage(page: StudioPage): StudioPage {
  const elements: StudioElement[] = page.elements.map((element) => (element.kind === "image" && !element.src ? placeholderOf(element) : element));
  return { ...page, elements };
}

export function thumbnailSide(box: number, ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1): number {
  return Math.min(MAX_SIDE, Math.ceil(box * ratio * HEADROOM));
}
