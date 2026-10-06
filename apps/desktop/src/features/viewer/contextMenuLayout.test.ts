import { Copy, FileText, Image } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { arrangeMenu, menuFocus, pointOnRects, withoutItems, type MenuGroup } from "./contextMenuLayout";

const item = (id: string): ContextMenuItem => ({ type: "item", id, label: id, onSelect: vi.fn() });

function groups(selection: string[], picture: string[], page: string[]): MenuGroup[] {
  return [
    { id: "selection", label: "Selected text", icon: Copy, items: selection.map(item) },
    { id: "picture", label: "Picture", icon: Image, items: picture.map(item) },
    { id: "page", label: "Page", icon: FileText, items: page.map(item) },
  ];
}

const ids = (items: ContextMenuItem[]) => items.map((entry) => entry.id);

describe("pointOnRects", () => {
  const rects = [{ origin: { x: 72, y: 74 }, size: { width: 160, height: 20 } }];

  it("counts a point on or just beside a highlighted line", () => {
    expect(pointOnRects(rects, 150, 84)).toBe(true);
    expect(pointOnRects(rects, 70, 72)).toBe(true);
  });

  it("does not count a point elsewhere on the page", () => {
    expect(pointOnRects(rects, 300, 84)).toBe(false);
    expect(pointOnRects(rects, 150, 120)).toBe(false);
    expect(pointOnRects([], 150, 84)).toBe(false);
  });
});

describe("menuFocus", () => {
  it("prefers the selection under the pointer, then a picture, then the page", () => {
    expect(menuFocus({ onSelection: true, hasPicture: true })).toBe("selection");
    expect(menuFocus({ onSelection: false, hasPicture: true })).toBe("picture");
    expect(menuFocus({ onSelection: false, hasPicture: false })).toBe("page");
  });
});

describe("arrangeMenu", () => {
  it("opens the focused group and folds every other group into a named submenu", () => {
    const arranged = arrangeMenu(groups(["copy-text"], ["copy-image"], ["go-to-page"]), "selection");
    expect(ids(arranged)).toEqual(["copy-text", "sep-selection-groups", "group-picture", "group-page"]);
    const folded = arranged[2];
    expect(folded.type === "submenu" && folded.label).toBe("Picture");
    expect(folded.type === "submenu" && ids(folded.items)).toEqual(["copy-image"]);
  });

  it("shows only the page group, unfolded, when nothing else is under the pointer", () => {
    expect(ids(arrangeMenu(groups([], [], ["go-to-page", "print-page"]), "page"))).toEqual(["go-to-page", "print-page"]);
  });

  it("skips empty groups and falls back to the page group when the focused one is empty", () => {
    expect(ids(arrangeMenu(groups([], ["copy-image"], ["go-to-page"]), "selection"))).toEqual(["go-to-page", "sep-page-groups", "group-picture"]);
    expect(arrangeMenu(groups([], [], []), "page")).toEqual([]);
  });
});

describe("withoutItems", () => {
  const separator = (id: string): ContextMenuItem => ({ type: "separator", id });
  const submenu = (id: string, items: ContextMenuItem[]): ContextMenuItem => ({ type: "submenu", id, label: id, items });

  it("drops hidden items inside submenus and submenus left empty", () => {
    const menu = [item("copy"), submenu("export", [item("png"), item("snapshot")]), submenu("searchable", [item("page"), item("document")])];
    const kept = withoutItems(menu, new Set(["snapshot", "page", "document"]));
    expect(ids(kept)).toEqual(["copy", "export"]);
    expect(ids((kept[1] as { items: ContextMenuItem[] }).items)).toEqual(["png"]);
  });

  it("never leaves a separator at either end or two in a row", () => {
    const menu = [item("bookmark"), separator("a"), item("go"), separator("b"), item("print"), separator("c"), item("edit")];
    expect(ids(withoutItems(menu, new Set(["bookmark", "print", "edit"])))).toEqual(["go"]);
  });

  it("keeps every item when nothing is hidden", () => {
    const menu = [item("one"), separator("a"), item("two")];
    expect(withoutItems(menu, new Set())).toEqual(menu);
  });
});
