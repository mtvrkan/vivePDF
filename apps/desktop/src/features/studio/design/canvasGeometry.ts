import { graphicOf } from "../graphics/graphicData";
import { guidesOf, marginsOf } from "../model/guides";
import { isLineShape } from "../model/shapes";
import { elementBounds, type Bounds } from "../model/edit";
import type { StudioDesign, StudioElement, StudioPage } from "@/types/studio";
import { buildSnapIndex, type SnapExtras, type SnapIndex } from "./snapping";
import { HANDLES, type Handle, type Vector } from "./transform";
import { fromMm } from "./units";
import { useViewPrefs } from "./viewPrefs";

export const PAD = 48;

export type Point = Vector;

const COMPASS: Handle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const CURSOR_TURNS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"];

export function cursorFor(handle: Handle, rotation: number): string {
  const step = COMPASS.indexOf(handle) + Math.round(rotation / 45);
  return CURSOR_TURNS[((step % 4) + 4) % 4];
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function isLine(element: StudioElement): boolean {
  return element.kind === "shape" && isLineShape(element.shape);
}

export function handlesFor(elements: StudioElement[]): Handle[] {
  if (elements.length !== 1) return ["nw", "ne", "se", "sw"];
  const [element] = elements;
  if (isLine(element)) return [];
  if (element.kind === "text") return ["nw", "ne", "se", "sw", "e", "w"];
  if (graphicOf(element)?.kind === "table") return ["e", "w"];
  return HANDLES;
}

export function handlePosition(handle: Handle, width: number, height: number): Point {
  return { x: handle.includes("e") ? width : handle.includes("w") ? 0 : width / 2, y: handle.includes("s") ? height : handle.includes("n") ? 0 : height / 2 };
}

function snapExtras(page: StudioPage, design: StudioDesign): SnapExtras {
  const view = useViewPrefs.getState();
  const extras: SnapExtras = { x: [], y: [] };
  if (view.guides) for (const guide of guidesOf(page)) extras[guide.axis].push(guide.position);
  const inset = fromMm(marginsOf(design));
  if (view.margins && inset > 0) {
    extras.x.push(inset, page.width - inset);
    extras.y.push(inset, page.height - inset);
  }
  return extras;
}

export function snapIndexFor(page: StudioPage, design: StudioDesign, exclude: ReadonlySet<string>): SnapIndex {
  const others = page.elements.filter((element) => !exclude.has(element.id) && !element.hidden).map(elementBounds);
  return buildSnapIndex(page, others, snapExtras(page, design));
}
