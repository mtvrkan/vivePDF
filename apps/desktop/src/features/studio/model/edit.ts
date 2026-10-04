import type { StudioDesign, StudioElement, StudioPage } from "@/types/studio";
import { MAX_ELEMENTS_PER_PAGE, MAX_PAGE_SIDE, MAX_PAGES, MIN_ELEMENT_SIDE, MIN_PAGE_SIDE, createPage, newId } from "./design";

export type Bounds = { x: number; y: number; width: number; height: number };
export type AlignMode = "left" | "centerX" | "right" | "top" | "middleY" | "bottom";
export type AlignTarget = "selection" | "page";
export type ReorderDirection = "forward" | "backward" | "front" | "back";
export type LayerRun = { groupId: string | null; elements: StudioElement[] };
export type PageResizeMode = "keep" | "scale";

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

export function layerRuns(elements: readonly StudioElement[]): LayerRun[] {
  const runs: LayerRun[] = [];
  for (const element of elements) {
    const last = runs[runs.length - 1];
    if (last && element.groupId !== null && last.groupId === element.groupId) last.elements.push(element);
    else runs.push({ groupId: element.groupId, elements: [element] });
  }
  return runs;
}

function shiftChosen<T>(items: readonly T[], chosen: (item: T) => boolean, direction: ReorderDirection): T[] {
  const picked = items.filter(chosen);
  const others = items.filter((item) => !chosen(item));
  if (!picked.length || !others.length) return [...items];
  if (direction === "front") return [...others, ...picked];
  if (direction === "back") return [...picked, ...others];
  const order = [...items];
  if (direction === "forward") {
    for (let index = order.length - 2; index >= 0; index -= 1) {
      if (chosen(order[index]) && !chosen(order[index + 1])) [order[index], order[index + 1]] = [order[index + 1], order[index]];
    }
  } else {
    for (let index = 1; index < order.length; index += 1) {
      if (chosen(order[index]) && !chosen(order[index - 1])) [order[index], order[index - 1]] = [order[index - 1], order[index]];
    }
  }
  return order;
}

function withElements(page: StudioPage, elements: StudioElement[]): StudioPage {
  return elements.length === page.elements.length && elements.every((element, index) => element === page.elements[index]) ? page : { ...page, elements };
}

export function reorderElements(page: StudioPage, ids: readonly string[], direction: ReorderDirection): StudioPage {
  const chosen = new Set(ids);
  const isChosen = (element: StudioElement) => chosen.has(element.id);
  const whole = (run: LayerRun) => run.elements.every(isChosen);
  const runs = layerRuns(page.elements).map((run) => (!whole(run) && run.elements.some(isChosen) ? { ...run, elements: shiftChosen(run.elements, isChosen, direction) } : run));
  return withElements(page, shiftChosen(runs, whole, direction).flatMap((run) => run.elements));
}

function lastIndexOf<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (test(items[index])) return index;
  return -1;
}

function nearestRunEdge(elements: readonly StudioElement[], at: number): number {
  const groupId = at > 0 && at < elements.length ? elements[at].groupId : null;
  if (groupId === null || elements[at - 1].groupId !== groupId) return at;
  let start = at;
  while (start > 0 && elements[start - 1].groupId === groupId) start -= 1;
  let end = at;
  while (end < elements.length && elements[end].groupId === groupId) end += 1;
  return at - start <= end - at ? start : end;
}

export function placeElements(page: StudioPage, ids: readonly string[], index: number): StudioPage {
  const chosen = new Set(ids);
  const moving = page.elements.filter((element) => chosen.has(element.id));
  if (!moving.length) return page;
  const rest = page.elements.filter((element) => !chosen.has(element.id));
  const passed = page.elements.slice(0, Math.max(0, index)).filter((element) => chosen.has(element.id)).length;
  let at = Math.max(0, Math.min(rest.length, index - passed));
  const groupId = moving[0].groupId;
  const inside = groupId !== null && moving.every((element) => element.groupId === groupId) && rest.some((element) => element.groupId === groupId);
  if (inside) {
    const first = rest.findIndex((element) => element.groupId === groupId);
    const last = lastIndexOf(rest, (element) => element.groupId === groupId);
    at = Math.max(first, Math.min(last + 1, at));
  } else {
    at = nearestRunEdge(rest, at);
  }
  return withElements(page, [...rest.slice(0, at), ...moving, ...rest.slice(at)]);
}

export function groupElements(page: StudioPage, ids: readonly string[]): { page: StudioPage; groupId: string | null } {
  const chosen = new Set(expandToGroups(page, ids));
  if (chosen.size < 2) return { page, groupId: null };
  const groupId = newId();
  const top = lastIndexOf(page.elements, (element) => chosen.has(element.id));
  const members = page.elements.filter((element) => chosen.has(element.id)).map((element) => ({ ...element, groupId }));
  const below = page.elements.slice(0, top + 1).filter((element) => !chosen.has(element.id));
  return { page: { ...page, elements: [...below, ...members, ...page.elements.slice(top + 1)] }, groupId };
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

function pageSide(value: number): number {
  return Math.min(MAX_PAGE_SIDE, Math.max(MIN_PAGE_SIDE, Number.isFinite(value) ? value : MIN_PAGE_SIDE));
}

function scaledStroke<T extends { width: number }>(stroke: T | null, factor: number): T | null {
  return stroke ? { ...stroke, width: Math.min(500, Math.max(0.1, stroke.width * factor)) } : null;
}

function scaleElement(element: StudioElement, factor: number, dx: number, dy: number): StudioElement {
  const box = {
    ...element,
    x: element.x * factor + dx,
    y: element.y * factor + dy,
    width: Math.max(MIN_ELEMENT_SIDE, element.width * factor),
    height: Math.max(MIN_ELEMENT_SIDE, element.height * factor),
  };
  if (box.kind === "text") return { ...box, fontSize: Math.min(1000, Math.max(1, box.fontSize * factor)) };
  if (box.kind === "shape" || box.kind === "image") return { ...box, cornerRadius: box.cornerRadius * factor, stroke: scaledStroke(box.stroke, factor) };
  return box;
}

export function resizePage(page: StudioPage, width: number, height: number, mode: PageResizeMode): StudioPage {
  const nextWidth = pageSide(width);
  const nextHeight = pageSide(height);
  if (nextWidth === page.width && nextHeight === page.height) return page;
  if (mode === "keep" || !page.elements.length) return { ...page, width: nextWidth, height: nextHeight };
  const factor = Math.min(nextWidth / page.width, nextHeight / page.height);
  const dx = (nextWidth - page.width * factor) / 2;
  const dy = (nextHeight - page.height * factor) / 2;
  return { ...page, width: nextWidth, height: nextHeight, elements: page.elements.map((element) => scaleElement(element, factor, dx, dy)) };
}

export function resizeAllPages(design: StudioDesign, width: number, height: number, mode: PageResizeMode): StudioDesign {
  const pages = design.pages.map((page) => resizePage(page, width, height, mode));
  return pages.every((page, index) => page === design.pages[index]) ? design : { ...design, pages };
}
