import type { StudioElement, StudioPage } from "@/types/studio";
import { layerRuns, placeElements } from "../model/edit";
import type { DropProbe, DropSide } from "./dragSort";

export type GroupRow = { kind: "group"; key: string; groupId: string; elements: StudioElement[]; start: number; end: number; open: boolean };
export type ElementRow = { kind: "element"; key: string; element: StudioElement; index: number; groupId: string | null; member: boolean };
export type LayerRow = GroupRow | ElementRow;
export type LayerSource = { ids: string[]; groupId: string | null };
export type LayerDrop = { key: string; side: DropSide; index: number };

export function layerRows(page: StudioPage, isOpen: (groupId: string) => boolean): LayerRow[] {
  const placed: { elements: StudioElement[]; groupId: string | null; start: number }[] = [];
  let offset = 0;
  for (const run of layerRuns(page.elements)) {
    placed.push({ ...run, start: offset });
    offset += run.elements.length;
  }
  const seen = new Map<string, number>();
  const rows: LayerRow[] = [];
  for (const run of placed.reverse()) {
    if (run.groupId === null) {
      rows.push({ kind: "element", key: run.elements[0].id, element: run.elements[0], index: run.start, groupId: null, member: false });
      continue;
    }
    const count = (seen.get(run.groupId) ?? 0) + 1;
    seen.set(run.groupId, count);
    const open = isOpen(run.groupId);
    const end = run.start + run.elements.length - 1;
    rows.push({ kind: "group", key: count > 1 ? `group:${run.groupId}:${count}` : `group:${run.groupId}`, groupId: run.groupId, elements: run.elements, start: run.start, end, open });
    if (!open) continue;
    for (let index = run.elements.length - 1; index >= 0; index -= 1) {
      rows.push({ kind: "element", key: run.elements[index].id, element: run.elements[index], index: run.start + index, groupId: run.groupId, member: true });
    }
  }
  return rows;
}

export function layerSource(row: LayerRow): LayerSource {
  if (row.kind === "group") return { ids: row.elements.map((element) => element.id), groupId: null };
  return { ids: [row.element.id], groupId: row.member ? row.groupId : null };
}

function besideElement(row: ElementRow, side: DropSide): LayerDrop {
  return { key: row.key, side, index: side === "before" ? row.index + 1 : row.index };
}

function headerOf(rows: LayerRow[], index: number): GroupRow | null {
  return rows.find((row): row is GroupRow => row.kind === "group" && row.start <= index && index <= row.end) ?? null;
}

function memberTarget(rows: LayerRow[], source: LayerSource, row: LayerRow, side: DropSide): LayerDrop | null {
  const home = rows.find((item): item is GroupRow => item.kind === "group" && item.elements.some((element) => element.id === source.ids[0]));
  if (!home) return null;
  const members = rows.filter((item): item is ElementRow => item.kind === "element" && item.member && item.index >= home.start && item.index <= home.end);
  if (!members.length) return null;
  if (row.kind === "element" && row.member && row.index >= home.start && row.index <= home.end) return besideElement(row, side);
  const position = rows.indexOf(row);
  return position <= rows.indexOf(home) ? besideElement(members[0], "before") : besideElement(members[members.length - 1], "after");
}

function unitTarget(rows: LayerRow[], row: LayerRow, side: DropSide): LayerDrop | null {
  if (row.kind === "group") return side === "before" || row.open ? { key: row.key, side: "before", index: row.end + 1 } : { key: row.key, side: "after", index: row.start };
  if (!row.member) return besideElement(row, side);
  const header = headerOf(rows, row.index);
  if (!header) return null;
  const size = header.end - header.start + 1;
  const upper = (row.index - header.start) * 2 + (side === "before" ? 1 : 0) >= size;
  if (upper) return { key: header.key, side: "before", index: header.end + 1 };
  const bottom = rows.find((item): item is ElementRow => item.kind === "element" && item.index === header.start);
  return bottom ? besideElement(bottom, "after") : { key: header.key, side: "after", index: header.start };
}

export function resolveLayerDrop(page: StudioPage, rows: LayerRow[], source: LayerSource, probe: DropProbe): LayerDrop | null {
  const row = rows.find((item) => item.key === probe.key);
  if (!row) return null;
  const target = source.groupId !== null ? memberTarget(rows, source, row, probe.side) : unitTarget(rows, row, probe.side);
  if (!target) return null;
  return placeElements(page, source.ids, target.index) === page ? null : target;
}
