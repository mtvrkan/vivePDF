import type { CommentItem } from "@/types";

export type ThreadEntry = { item: CommentItem; depth: number };

export function commentThreads(items: CommentItem[], keepRoot: (item: CommentItem) => boolean): ThreadEntry[] {
  const known = new Set(items.map((item) => item.xref));
  const children = new Map<number, CommentItem[]>();
  const roots: CommentItem[] = [];
  for (const item of items) {
    if (item.parent !== null && item.parent !== undefined && known.has(item.parent) && item.parent !== item.xref) {
      const siblings = children.get(item.parent) ?? [];
      siblings.push(item);
      children.set(item.parent, siblings);
    } else {
      roots.push(item);
    }
  }
  const entries: ThreadEntry[] = [];
  const visited = new Set<number>();
  const walk = (item: CommentItem, depth: number) => {
    if (visited.has(item.xref)) return;
    visited.add(item.xref);
    entries.push({ item, depth });
    for (const child of children.get(item.xref) ?? []) walk(child, depth + 1);
  };
  const reachable = new Set<number>();
  const reach = (item: CommentItem) => {
    if (reachable.has(item.xref)) return;
    reachable.add(item.xref);
    for (const child of children.get(item.xref) ?? []) reach(child);
  };
  roots.forEach(reach);
  for (const root of roots) if (keepRoot(root)) walk(root, 0);
  for (const item of items) if (!visited.has(item.xref) && !reachable.has(item.xref) && keepRoot(item)) walk(item, 0);
  return entries;
}
