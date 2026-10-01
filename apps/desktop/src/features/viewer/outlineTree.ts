import { PdfActionType, type PdfBookmarkObject, type PdfLinkTarget } from "@embedpdf/models";

export type OutlineRow = {
  id: string;
  parentId: string | null;
  depth: number;
  title: string;
  target: PdfLinkTarget | null;
  pageIndex: number | null;
  uri: string | null;
  hasChildren: boolean;
};

export function targetPageIndex(target: PdfLinkTarget | null | undefined): number | null {
  if (!target) return null;
  if (target.type === "destination") return target.destination.pageIndex;
  if (target.action.type === PdfActionType.Goto) return target.action.destination.pageIndex;
  return null;
}

function targetUri(target: PdfLinkTarget | null | undefined): string | null {
  if (!target || target.type !== "action") return null;
  return target.action.type === PdfActionType.URI ? target.action.uri : null;
}

export function flattenOutline(bookmarks: PdfBookmarkObject[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const visit = (items: PdfBookmarkObject[], parentId: string | null, depth: number) => {
    items.forEach((item, index) => {
      const id = parentId === null ? String(index) : `${parentId}.${index}`;
      const children = item.children ?? [];
      const target = item.target ?? null;
      rows.push({
        id,
        parentId,
        depth,
        title: item.title.replace(/\s+/g, " ").trim(),
        target,
        pageIndex: targetPageIndex(target),
        uri: targetUri(target),
        hasChildren: children.length > 0,
      });
      visit(children, id, depth + 1);
    });
  };
  visit(bookmarks, null, 0);
  return rows;
}

export function ancestorIds(id: string): string[] {
  const parts = id.split(".");
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join("."));
}

export function activeOutlineId(rows: OutlineRow[], pageIndex: number): string | null {
  let best: OutlineRow | null = null;
  for (const row of rows) {
    if (row.pageIndex === null || row.pageIndex > pageIndex) continue;
    if (best === null || row.pageIndex >= (best.pageIndex ?? 0)) best = row;
  }
  return best?.id ?? null;
}

function normalized(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export function visibleOutline(rows: OutlineRow[], expanded: ReadonlySet<string>, filter: string): OutlineRow[] {
  const query = normalized(filter.trim());
  if (query) {
    const shown = new Set<string>();
    for (const row of rows) {
      if (!normalized(row.title).includes(query)) continue;
      shown.add(row.id);
      ancestorIds(row.id).forEach((id) => shown.add(id));
    }
    return rows.filter((row) => shown.has(row.id));
  }
  return rows.filter((row) => ancestorIds(row.id).every((id) => expanded.has(id)));
}

export function shownActiveId(visible: OutlineRow[], activeId: string | null): string | null {
  if (activeId === null) return null;
  const ids = new Set(visible.map((row) => row.id));
  if (ids.has(activeId)) return activeId;
  return [...ancestorIds(activeId)].reverse().find((id) => ids.has(id)) ?? null;
}
