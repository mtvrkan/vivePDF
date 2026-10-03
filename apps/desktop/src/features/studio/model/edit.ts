import type { StudioDesign, StudioElement, StudioPage } from "@/types/studio";
import { MAX_ELEMENTS_PER_PAGE, MAX_PAGES, createPage, newId } from "./design";

export type Bounds = { x: number; y: number; width: number; height: number };
export type AlignMode = "left" | "centerX" | "right" | "top" | "middleY" | "bottom";
export type AlignTarget = "selection" | "page";
export type ReorderDirection = "forward" | "backward" | "front" | "back";

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

function groupMapper(): (groupId: string | null) => string | null {
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

export function duplicateElements(page: StudioPage, ids: readonly string[], offset: number): { page: StudioPage; ids: string[] } {
  const chosen = new Set(ids);
  const regroup = groupMapper();
  const copies = page.elements
    .filter((element) => chosen.has(element.id))
    .map((element) => ({ ...structuredClone(element), id: newId(), x: element.x + offset, y: element.y + offset, locked: false, groupId: regroup(element.groupId) }));
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

export function reorderElements(page: StudioPage, ids: readonly string[], direction: ReorderDirection): StudioPage {
  const chosen = new Set(ids);
  const picked = page.elements.filter((element) => chosen.has(element.id));
  const others = page.elements.filter((element) => !chosen.has(element.id));
  if (!picked.length || !others.length) return page;
  if (direction === "front") return { ...page, elements: [...others, ...picked] };
  if (direction === "back") return { ...page, elements: [...picked, ...others] };
  const order = [...page.elements];
  if (direction === "forward") {
    for (let index = order.length - 2; index >= 0; index -= 1) {
      if (chosen.has(order[index].id) && !chosen.has(order[index + 1].id)) [order[index], order[index + 1]] = [order[index + 1], order[index]];
    }
  } else {
    for (let index = 1; index < order.length; index += 1) {
      if (chosen.has(order[index].id) && !chosen.has(order[index - 1].id)) [order[index], order[index - 1]] = [order[index - 1], order[index]];
    }
  }
  return { ...page, elements: order };
}

export function groupElements(page: StudioPage, ids: readonly string[]): { page: StudioPage; groupId: string | null } {
  const chosen = new Set(expandToGroups(page, ids));
  if (chosen.size < 2) return { page, groupId: null };
  const groupId = newId();
  return { page: { ...page, elements: page.elements.map((element) => (chosen.has(element.id) ? { ...element, groupId } : element)) }, groupId };
}

export function ungroupElements(page: StudioPage, ids: readonly string[]): StudioPage {
  const chosen = new Set(ids);
  const groups = new Set(page.elements.filter((element) => chosen.has(element.id) && element.groupId).map((element) => element.groupId));
  if (!groups.size) return page;
  return { ...page, elements: page.elements.map((element) => (element.groupId !== null && groups.has(element.groupId) ? { ...element, groupId: null } : element)) };
}

export function updatePage(design: StudioDesign, pageId: string, change: (page: StudioPage) => StudioPage): StudioDesign {
  return { ...design, pages: design.pages.map((page) => (page.id === pageId ? change(page) : page)) };
}

export function addPage(design: StudioDesign, afterId: string | null): { design: StudioDesign; pageId: string | null } {
  if (design.pages.length >= MAX_PAGES) return { design, pageId: null };
  const index = afterId ? design.pages.findIndex((page) => page.id === afterId) : design.pages.length - 1;
  const template = design.pages[Math.max(0, index)];
  const page = createPage(template.width, template.height);
  const pages = [...design.pages];
  pages.splice(index + 1, 0, page);
  return { design: { ...design, pages }, pageId: page.id };
}

export function duplicatePage(design: StudioDesign, pageId: string): { design: StudioDesign; pageId: string | null } {
  const index = design.pages.findIndex((page) => page.id === pageId);
  if (index < 0 || design.pages.length >= MAX_PAGES) return { design, pageId: null };
  const regroup = groupMapper();
  const source = design.pages[index];
  const copy: StudioPage = {
    ...structuredClone(source),
    id: newId(),
    elements: source.elements.map((element) => ({ ...structuredClone(element), id: newId(), groupId: regroup(element.groupId) })),
  };
  const pages = [...design.pages];
  pages.splice(index + 1, 0, copy);
  return { design: { ...design, pages }, pageId: copy.id };
}

export function removePage(design: StudioDesign, pageId: string): StudioDesign {
  if (design.pages.length <= 1) return design;
  return { ...design, pages: design.pages.filter((page) => page.id !== pageId) };
}

export function movePage(design: StudioDesign, pageId: string, index: number): StudioDesign {
  const from = design.pages.findIndex((page) => page.id === pageId);
  if (from < 0) return design;
  const pages = [...design.pages];
  const [page] = pages.splice(from, 1);
  pages.splice(Math.max(0, Math.min(pages.length, index)), 0, page);
  return { ...design, pages };
}
