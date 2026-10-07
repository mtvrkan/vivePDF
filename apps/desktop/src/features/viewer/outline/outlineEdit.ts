import { isPageTarget, subtreeEnd, withPage } from "@/shared/lib/bookmarkTree";
import type { PendingChange } from "@/shared/store/pendingChangesStore";
import type { BookmarkItem } from "@/types";
import type { OutlineRow } from "../outlineTree";

export type AddedBookmark = { title: string; page: number; y?: number };

type OutlineReplaced = Extract<PendingChange, { kind: "outlineReplaced" }>;
type BookmarkAdded = Extract<PendingChange, { kind: "bookmarkAdded" }>;

export function pendingOutline(changes: PendingChange[]): OutlineReplaced | null {
  return changes.find((change): change is OutlineReplaced => change.kind === "outlineReplaced") ?? null;
}

export function pendingAdditions(changes: PendingChange[]): BookmarkAdded[] {
  return changes.filter((change): change is BookmarkAdded => change.kind === "bookmarkAdded");
}

export function addedItem({ title, page, y }: AddedBookmark): BookmarkItem {
  return { level: 1, title, page, top: y ?? null };
}

export function insertionIndexForPage(items: BookmarkItem[], page: number): number {
  const index = items.findIndex((item) => item.level === 1 && isPageTarget(item) && item.page > page);
  return index < 0 ? items.length : index;
}

export function mergeAddedBookmarks(items: BookmarkItem[], added: AddedBookmark[]): BookmarkItem[] {
  return added.reduce((current, entry) => {
    const index = insertionIndexForPage(current, entry.page);
    return [...current.slice(0, index), addedItem(entry), ...current.slice(index)];
  }, items);
}

function shiftBranch(items: BookmarkItem[], index: number, delta: number): BookmarkItem[] {
  const end = subtreeEnd(items, index);
  return items.map((item, position) => (position >= index && position < end ? { ...item, level: item.level + delta } : item));
}

export function canIndent(items: BookmarkItem[], index: number): boolean {
  return index > 0 && index < items.length && items[index - 1].level >= items[index].level;
}

export function canOutdent(items: BookmarkItem[], index: number): boolean {
  return index >= 0 && index < items.length && items[index].level > 1;
}

export function indentBookmark(items: BookmarkItem[], index: number): BookmarkItem[] {
  return canIndent(items, index) ? shiftBranch(items, index, 1) : items;
}

export function outdentBookmark(items: BookmarkItem[], index: number): BookmarkItem[] {
  return canOutdent(items, index) ? shiftBranch(items, index, -1) : items;
}

export function deleteBookmarkBranch(items: BookmarkItem[], index: number): BookmarkItem[] {
  return [...items.slice(0, index), ...items.slice(subtreeEnd(items, index))];
}

export function renameBookmark(items: BookmarkItem[], index: number, title: string): BookmarkItem[] {
  return items.map((item, position) => (position === index ? { ...item, title } : item));
}

export function linkBookmarkToPage(items: BookmarkItem[], index: number, page: number): BookmarkItem[] {
  return items.map((item, position) => {
    if (position !== index) return item;
    if (isPageTarget(item)) return withPage(item, page);
    return { ...item, target: "page", uri: null, file: null, page, left: null, top: null, fit: null, fitArgs: null };
  });
}

export function insertChild(items: BookmarkItem[], index: number, child: Omit<BookmarkItem, "level">): { items: BookmarkItem[]; index: number } {
  const at = subtreeEnd(items, index);
  return { items: [...items.slice(0, at), { ...child, level: items[index].level + 1 }, ...items.slice(at)], index: at };
}

export function insertSibling(items: BookmarkItem[], index: number | null, sibling: Omit<BookmarkItem, "level">): { items: BookmarkItem[]; index: number } {
  if (index === null || index < 0 || index >= items.length) {
    const at = insertionIndexForPage(items, sibling.page);
    return { items: [...items.slice(0, at), { ...sibling, level: 1 }, ...items.slice(at)], index: at };
  }
  const at = subtreeEnd(items, index);
  return { items: [...items.slice(0, at), { ...sibling, level: items[index].level }, ...items.slice(at)], index: at };
}

export function rowsFromItems(items: BookmarkItem[]): OutlineRow[] {
  const path: number[] = [];
  return items.map((item, index) => {
    const depth = Math.max(0, item.level - 1);
    path.length = depth + 1;
    path[depth] = (path[depth] ?? -1) + 1;
    const ids = path.map((value) => value ?? 0);
    const next = items[index + 1];
    return {
      id: ids.join("."),
      parentId: depth === 0 ? null : ids.slice(0, depth).join("."),
      depth,
      title: item.title.replace(/\s+/g, " ").trim(),
      target: null,
      pageIndex: isPageTarget(item) && item.page > 0 ? item.page - 1 : null,
      uri: item.target === "web" ? (item.uri ?? null) : null,
      hasChildren: next !== undefined && next.level > item.level,
    };
  });
}
