import type { BookmarkItem } from "@/types";

type BookmarkNode = { item: BookmarkItem; children: BookmarkNode[] };

export type BookmarkIssue = "levels" | "title" | "page";

function buildTree(items: BookmarkItem[]): BookmarkNode[] {
  const roots: BookmarkNode[] = [];
  const stack: BookmarkNode[] = [];
  for (const item of items) {
    const node: BookmarkNode = { item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].item.level >= item.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function sortKey(item: BookmarkItem): number {
  return item.page > 0 && (item.target ?? "page") === "page" ? item.page : Number.POSITIVE_INFINITY;
}

function flatten(nodes: BookmarkNode[], sort: boolean): BookmarkItem[] {
  const ordered = sort ? [...nodes].sort((left, right) => sortKey(left.item) - sortKey(right.item)) : nodes;
  return ordered.flatMap((node) => [node.item, ...flatten(node.children, sort)]);
}

export function sortBookmarksByPage(items: BookmarkItem[]): BookmarkItem[] {
  return flatten(buildTree(items), true);
}

export function hasChildren(items: BookmarkItem[], index: number): boolean {
  const next = items[index + 1];
  return next !== undefined && next.level > items[index].level;
}

export function setAllCollapsed(items: BookmarkItem[], collapsed: boolean): BookmarkItem[] {
  return items.map((item, index) => (hasChildren(items, index) ? { ...item, collapsed } : { ...item, collapsed: false }));
}

export function subtreeEnd(items: BookmarkItem[], index: number): number {
  let end = index + 1;
  while (end < items.length && items[end].level > items[index].level) end += 1;
  return end;
}

export function moveBookmarkBranch(items: BookmarkItem[], index: number, delta: number): BookmarkItem[] {
  const level = items[index].level;
  const end = subtreeEnd(items, index);
  const branch = items.slice(index, end);
  const rest = [...items.slice(0, index), ...items.slice(end)];
  if (delta < 0) {
    let target = index - 1;
    while (target >= 0 && rest[target].level > level) target -= 1;
    if (target < 0 || rest[target].level < level) return items;
    return [...rest.slice(0, target), ...branch, ...rest.slice(target)];
  }
  if (end >= items.length || items[end].level < level) return items;
  const after = subtreeEnd(rest, index);
  return [...rest.slice(0, after), ...branch, ...rest.slice(after)];
}

export function isPageTarget(item: BookmarkItem): boolean {
  return (item.target ?? "page") === "page";
}

export function withPage(item: BookmarkItem, page: number): BookmarkItem {
  if (page === item.page) return item;
  const keepsFit = item.fit !== "FitR";
  return { ...item, page, left: null, top: null, fit: keepsFit ? item.fit : null, fitArgs: null };
}

export function titleMissing(item: BookmarkItem): boolean {
  return item.title.trim() === "";
}

export function pageOutOfRange(item: BookmarkItem, pageCount: number): boolean {
  return isPageTarget(item) && (!Number.isInteger(item.page) || item.page < 0 || item.page > pageCount);
}

export function bookmarkIssue(items: BookmarkItem[], pageCount: number): BookmarkIssue | null {
  let previousLevel = 0;
  for (const item of items) {
    if (item.level < 1 || item.level > previousLevel + 1) return "levels";
    previousLevel = item.level;
  }
  if (items.some(titleMissing)) return "title";
  if (items.some((item) => pageOutOfRange(item, pageCount))) return "page";
  return null;
}

export function serializeBookmarks(items: BookmarkItem[]): string {
  const bookmarks = items.map((entry) => ({
    level: entry.level,
    title: entry.title,
    page: entry.page,
    ...(entry.left != null ? { left: entry.left } : {}),
    ...(entry.top != null ? { top: entry.top } : {}),
    ...(entry.zoom ? { zoom: entry.zoom } : {}),
    ...(entry.collapsed ? { collapsed: true } : {}),
    ...(entry.target && entry.target !== "page" ? { target: entry.target } : {}),
    ...(entry.uri ? { uri: entry.uri } : {}),
    ...(entry.file ? { file: entry.file } : {}),
    ...(entry.fit ? { fit: entry.fit } : {}),
    ...(entry.fitArgs ? { fitArgs: entry.fitArgs } : {}),
    ...(entry.color ? { color: entry.color } : {}),
    ...(entry.bold ? { bold: true } : {}),
    ...(entry.italic ? { italic: true } : {}),
  }));
  return `${JSON.stringify({ bookmarks }, null, 2)}\n`;
}
