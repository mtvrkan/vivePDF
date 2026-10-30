import { PdfActionType, type PdfBookmarkObject, type PdfLinkTarget } from "@embedpdf/models";

export type OutlineRow = { id: string; parentId: string | null; depth: number; title: string; pageIndex: number | null; uri: string | null; hasChildren: boolean };

export type TreeMove = { focus?: string; toggle?: string; activate?: string };

export function targetPageIndex(target: PdfLinkTarget | null | undefined): number | null {
  if (!target) return null;
  if (target.type === "destination") return target.destination.pageIndex;
  if (target.action.type === PdfActionType.Goto) return target.action.destination.pageIndex;
  return null;
}

export function targetUri(target: PdfLinkTarget | null | undefined): string | null {
  if (!target || target.type !== "action") return null;
  return target.action.type === PdfActionType.URI ? target.action.uri : null;
}

export function flattenOutline(bookmarks: PdfBookmarkObject[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const visit = (items: PdfBookmarkObject[], parentId: string | null, depth: number) => {
    items.forEach((item, index) => {
      const id = parentId === null ? String(index) : `${parentId}.${index}`;
      const children = item.children ?? [];
      rows.push({ id, parentId, depth, title: item.title.replace(/\s+/g, " ").trim(), pageIndex: targetPageIndex(item.target), uri: targetUri(item.target), hasChildren: children.length > 0 });
      visit(children, id, depth + 1);
    });
  };
  visit(bookmarks, null, 0);
  return rows;
}

export function ancestorIds(id: string): string[] {
  const parts = id.split(".");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("."));
}

export function visibleRows(rows: OutlineRow[], expanded: ReadonlySet<string>): OutlineRow[] {
  return rows.filter((row) => ancestorIds(row.id).every((id) => expanded.has(id)));
}

export function activeRowId(rows: OutlineRow[], pageIndex: number): string | null {
  let best: OutlineRow | null = null;
  for (const row of rows) {
    if (row.pageIndex === null || row.pageIndex > pageIndex) continue;
    if (!best || row.pageIndex >= (best.pageIndex ?? -1)) best = row;
  }
  return best?.id ?? null;
}

export function treeMove(visible: OutlineRow[], focusedId: string, key: string, expanded: ReadonlySet<string>): TreeMove | null {
  const index = visible.findIndex((row) => row.id === focusedId);
  const row = visible[index];
  if (!row) return visible[0] ? { focus: visible[0].id } : null;
  switch (key) {
    case "ArrowDown":
      return visible[index + 1] ? { focus: visible[index + 1].id } : {};
    case "ArrowUp":
      return visible[index - 1] ? { focus: visible[index - 1].id } : {};
    case "Home":
      return { focus: visible[0].id };
    case "End":
      return { focus: visible[visible.length - 1].id };
    case "ArrowRight":
      if (!row.hasChildren) return {};
      return expanded.has(row.id) ? { focus: visible[index + 1]?.id } : { toggle: row.id };
    case "ArrowLeft":
      if (row.hasChildren && expanded.has(row.id)) return { toggle: row.id };
      return row.parentId === null ? {} : { focus: row.parentId };
    case "Enter":
    case " ":
      return { activate: row.id };
    default:
      return null;
  }
}
