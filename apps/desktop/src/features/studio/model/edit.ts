import type { StudioDesign, StudioElement, StudioPage } from "@/types/studio";
import { MAX_ELEMENTS_PER_PAGE, newId } from "./design";

export type Bounds = { x: number; y: number; width: number; height: number };
export type AlignMode = "left" | "centerX" | "right" | "top" | "middleY" | "bottom";
export type AlignTarget = "selection" | "page";

export function elementBounds(element: Pick<StudioElement, "x" | "y" | "width" | "height" | "rotation">): Bounds {
  const angle = (element.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const width = element.width * cos + element.height * sin;
  const height = element.width * sin + element.height * cos;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

export function unionBounds(items: Bounds[]): Bounds | null {
  if (!items.length) return null;
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function selectionBounds(page: StudioPage, ids: readonly string[]): Bounds | null {
  const chosen = new Set(ids);
  return unionBounds(page.elements.filter((element) => chosen.has(element.id)).map(elementBounds));
}

export function expandToGroups(page: StudioPage, ids: readonly string[]): string[] {
  const chosen = new Set(ids);
  const groups = new Set(page.elements.filter((element) => chosen.has(element.id) && element.groupId).map((element) => element.groupId));
  return page.elements.filter((element) => chosen.has(element.id) || (element.groupId !== null && groups.has(element.groupId))).map((element) => element.id);
}

export function withoutGroupOf(page: StudioPage, ids: readonly string[], id: string): string[] {
  const groupId = page.elements.find((element) => element.id === id)?.groupId ?? null;
  const members = new Set(groupId === null ? [id] : page.elements.filter((element) => element.groupId === groupId).map((element) => element.id));
  return ids.filter((other) => !members.has(other));
}

export function distributableCount(page: StudioPage, ids: readonly string[]): number {
  return units(page, ids).length;
}

function units(page: StudioPage, ids: readonly string[]): StudioElement[][] {
  const chosen = new Set(ids);
  const byKey = new Map<string, StudioElement[]>();
  for (const element of page.elements) {
    if (!chosen.has(element.id) || element.locked) continue;
    const key = element.groupId ?? `#${element.id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), element]);
  }
  return [...byKey.values()];
}

export function groupMapper(): (groupId: string | null) => string | null {
  const groups = new Map<string, string>();
  return (groupId) => {
    if (!groupId) return null;
    if (!groups.has(groupId)) groups.set(groupId, newId());
    return groups.get(groupId) as string;
  };
}

function shifted(page: StudioPage, offsets: Map<string, { dx: number; dy: number }>): StudioPage {
  if (!offsets.size) return page;
  return {
    ...page,
    elements: page.elements.map((element) => {
      const offset = offsets.get(element.id);
      return offset && (offset.dx || offset.dy) ? { ...element, x: element.x + offset.dx, y: element.y + offset.dy } : element;
    }),
  };
}

export function onlyPositionDiffers(previous: StudioElement, next: StudioElement): boolean {
  if (previous === next) return true;
  if (previous.id !== next.id || previous.kind !== next.kind) return false;
  const before = previous as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  const keys = Object.keys(after);
  return keys.length === Object.keys(before).length && keys.every((key) => key === "x" || key === "y" || before[key] === after[key]);
}

export function updateElement<T extends StudioElement>(page: StudioPage, id: string, patch: Partial<T>): StudioPage {
  return { ...page, elements: page.elements.map((element) => (element.id === id ? ({ ...element, ...patch } as StudioElement) : element)) };
}

export function addElements(page: StudioPage, elements: StudioElement[]): StudioPage {
  const room = Math.max(0, MAX_ELEMENTS_PER_PAGE - page.elements.length);
  return { ...page, elements: [...page.elements, ...elements.slice(0, room)] };
}

export function removeElements(page: StudioPage, ids: readonly string[]): StudioPage {
  const chosen = new Set(ids);
  return { ...page, elements: page.elements.filter((element) => !chosen.has(element.id) || element.locked) };
}

export function moveElements(page: StudioPage, ids: readonly string[], dx: number, dy: number): StudioPage {
  const offsets = new Map<string, { dx: number; dy: number }>();
  for (const unit of units(page, ids)) for (const element of unit) offsets.set(element.id, { dx, dy });
  return shifted(page, offsets);
}

function completeGroups(page: StudioPage, chosen: ReadonlySet<string>): Set<string> {
  const total = new Map<string, number>();
  const picked = new Map<string, number>();
  for (const element of page.elements) {
    if (element.groupId === null) continue;
    total.set(element.groupId, (total.get(element.groupId) ?? 0) + 1);
    if (chosen.has(element.id)) picked.set(element.groupId, (picked.get(element.groupId) ?? 0) + 1);
  }
  return new Set([...picked].filter(([groupId, count]) => count > 1 && count === total.get(groupId)).map(([groupId]) => groupId));
}

export function duplicateElements(page: StudioPage, ids: readonly string[], offset: number): { page: StudioPage; ids: string[] } {
  const chosen = new Set(ids);
  const regroup = groupMapper();
  const whole = completeGroups(page, chosen);
  const copies = page.elements
    .filter((element) => chosen.has(element.id))
    .map((element) => ({ ...structuredClone(element), id: newId(), x: element.x + offset, y: element.y + offset, locked: false, groupId: element.groupId !== null && whole.has(element.groupId) ? regroup(element.groupId) : null }));
  const next = addElements(page, copies);
  const added = new Set(next.elements.map((element) => element.id));
  return { page: next, ids: copies.map((element) => element.id).filter((id) => added.has(id)) };
}

export function alignElements(page: StudioPage, ids: readonly string[], mode: AlignMode, target: AlignTarget): StudioPage {
  const groups = units(page, ids);
  const frame = target === "page" || groups.length < 2 ? { x: 0, y: 0, width: page.width, height: page.height } : unionBounds(groups.flatMap((unit) => unit.map(elementBounds)));
  if (!frame) return page;
  const offsets = new Map<string, { dx: number; dy: number }>();
  for (const unit of groups) {
    const box = unionBounds(unit.map(elementBounds)) as Bounds;
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = frame.x - box.x;
    if (mode === "centerX") dx = frame.x + frame.width / 2 - (box.x + box.width / 2);
    if (mode === "right") dx = frame.x + frame.width - (box.x + box.width);
    if (mode === "top") dy = frame.y - box.y;
    if (mode === "middleY") dy = frame.y + frame.height / 2 - (box.y + box.height / 2);
    if (mode === "bottom") dy = frame.y + frame.height - (box.y + box.height);
    for (const element of unit) offsets.set(element.id, { dx, dy });
  }
  return shifted(page, offsets);
}

export function distributeElements(page: StudioPage, ids: readonly string[], axis: "horizontal" | "vertical"): StudioPage {
  const boxes = units(page, ids).map((unit) => ({ unit, box: unionBounds(unit.map(elementBounds)) as Bounds }));
  if (boxes.length < 3) return page;
  const start = (box: Bounds) => (axis === "horizontal" ? box.x : box.y);
  const size = (box: Bounds) => (axis === "horizontal" ? box.width : box.height);
  boxes.sort((left, right) => start(left.box) + size(left.box) / 2 - (start(right.box) + size(right.box) / 2));
  const first = start(boxes[0].box);
  const last = boxes[boxes.length - 1];
  const span = start(last.box) + size(last.box) - first;
  const gap = (span - boxes.reduce((sum, item) => sum + size(item.box), 0)) / (boxes.length - 1);
  const offsets = new Map<string, { dx: number; dy: number }>();
  let cursor = first;
  for (const { unit, box } of boxes) {
    const delta = cursor - start(box);
    for (const element of unit) offsets.set(element.id, axis === "horizontal" ? { dx: delta, dy: 0 } : { dx: 0, dy: delta });
    cursor += size(box) + gap;
  }
  return shifted(page, offsets);
}

export function updatePage(design: StudioDesign, pageId: string, change: (page: StudioPage) => StudioPage): StudioDesign {
  return { ...design, pages: design.pages.map((page) => (page.id === pageId ? change(page) : page)) };
}
