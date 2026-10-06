import type { StudioElement, StudioPage } from "@/types/studio";
import { newId } from "./design";
import { expandToGroups } from "./edit";

export type ReorderDirection = "forward" | "backward" | "front" | "back";
export type LayerRun = { groupId: string | null; elements: StudioElement[] };

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
