import type { LucideIcon } from "lucide-react";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";

export type MenuFocus = "selection" | "picture" | "page";

export type MenuGroup = { id: MenuFocus; label: string; icon: LucideIcon; items: ContextMenuItem[] };

export type PageRect = { origin: { x: number; y: number }; size: { width: number; height: number } };

const POINTER_SLACK = 4;

export function pointOnRects(rects: PageRect[], x: number, y: number): boolean {
  return rects.some(
    (rect) =>
      x >= rect.origin.x - POINTER_SLACK &&
      x <= rect.origin.x + rect.size.width + POINTER_SLACK &&
      y >= rect.origin.y - POINTER_SLACK &&
      y <= rect.origin.y + rect.size.height + POINTER_SLACK,
  );
}

export function menuFocus({ onSelection, hasPicture }: { onSelection: boolean; hasPicture: boolean }): MenuFocus {
  if (onSelection) return "selection";
  return hasPicture ? "picture" : "page";
}

export function arrangeMenu(groups: MenuGroup[], focus: MenuFocus): ContextMenuItem[] {
  const present = groups.filter((group) => group.items.length > 0);
  const focused = present.find((group) => group.id === focus) ?? present[present.length - 1];
  if (!focused) return [];
  const others = present.filter((group) => group !== focused);
  if (others.length === 0) return focused.items;
  return [
    ...focused.items,
    { type: "separator", id: `sep-${focused.id}-groups` },
    ...others.map((group): ContextMenuItem => ({ type: "submenu", id: `group-${group.id}`, icon: group.icon, label: group.label, items: group.items })),
  ];
}

export function withoutItems(items: ContextMenuItem[], hidden: ReadonlySet<string>): ContextMenuItem[] {
  const kept: ContextMenuItem[] = [];
  for (const item of items) {
    if (hidden.has(item.id)) continue;
    if (item.type === "submenu") {
      const children = withoutItems(item.items, hidden);
      if (children.length > 0) kept.push({ ...item, items: children });
      continue;
    }
    if (item.type === "separator" && (kept.length === 0 || kept[kept.length - 1].type === "separator")) continue;
    kept.push(item);
  }
  while (kept.length > 0 && kept[kept.length - 1].type === "separator") kept.pop();
  return kept;
}
