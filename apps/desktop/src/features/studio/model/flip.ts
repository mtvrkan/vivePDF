import type { StudioElement, StudioPage } from "@/types/studio";
import { elementBounds, unionBounds } from "./edit";

export type FlipAxis = "horizontal" | "vertical";

type Point = { x: number; y: number };

export function withFlip<T extends StudioElement>(element: T, axis: FlipAxis, on: boolean): T {
  const key = axis === "horizontal" ? "flipX" : "flipY";
  const next: Record<string, unknown> = { ...element };
  if (on) next[key] = true;
  else delete next[key];
  return next as T;
}

export function isFlipped(element: StudioElement, axis: FlipAxis): boolean {
  return Boolean(axis === "horizontal" ? element.flipX : element.flipY);
}

export function flipInPlace<T extends StudioElement>(element: T, axis: FlipAxis): T {
  return withFlip(element, axis, !isFlipped(element, axis));
}

export function mirrorAcross<T extends StudioElement>(element: T, axis: FlipAxis, centre: Point): T {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const nextCx = axis === "horizontal" ? 2 * centre.x - cx : cx;
  const nextCy = axis === "vertical" ? 2 * centre.y - cy : cy;
  const turned = flipInPlace(element, axis);
  return { ...turned, x: nextCx - element.width / 2, y: nextCy - element.height / 2, rotation: element.rotation ? -element.rotation : 0 };
}

export function flipElements(page: StudioPage, ids: readonly string[], axis: FlipAxis): StudioPage {
  const chosen = new Set(ids);
  const targets = page.elements.filter((element) => chosen.has(element.id) && !element.locked);
  if (!targets.length) return page;
  const box = unionBounds(targets.map(elementBounds));
  const centre = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: 0, y: 0 };
  const single = targets.length === 1;
  const changed = new Map(targets.map((element) => [element.id, single ? flipInPlace(element, axis) : mirrorAcross(element, axis, centre)]));
  return { ...page, elements: page.elements.map((element) => changed.get(element.id) ?? element) };
}

export function flipTransform(element: Pick<StudioElement, "rotation" | "flipX" | "flipY">): string | undefined {
  const parts: string[] = [];
  if (element.rotation) parts.push(`rotate(${element.rotation}deg)`);
  if (element.flipX || element.flipY) parts.push(`scale(${element.flipX ? -1 : 1}, ${element.flipY ? -1 : 1})`);
  return parts.length ? parts.join(" ") : undefined;
}
