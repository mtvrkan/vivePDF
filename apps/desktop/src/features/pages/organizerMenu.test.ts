import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import type { OrganizerTile } from "@/types";
import { tileMenuItems, type TileMenuContext } from "./organizerMenu";

function page(index: number, sourceId = "main"): OrganizerTile {
  return { key: `p${index}`, kind: "page", sourceId, index, rotate: 0 };
}

const t = ((key: string, options?: { count?: number }) => (options?.count !== undefined ? `${key}:${options.count}` : key)) as unknown as TFunction;

function context(overrides: Partial<TileMenuContext> = {}): TileMenuContext {
  return {
    t,
    tiles: [page(1), page(2), page(3, "other")],
    selected: new Set(),
    cuts: new Set(),
    busy: false,
    canPaste: false,
    onPreview: vi.fn(),
    onOpenInViewer: vi.fn(),
    onRotate: vi.fn(),
    onDuplicate: vi.fn(),
    onCopies: vi.fn(),
    onReverse: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onPaste: vi.fn(),
    onToggleCut: vi.fn(),
    onExtract: vi.fn(),
    onInsertBlank: vi.fn(),
    onLabel: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
}

function item(items: ReturnType<typeof tileMenuItems>, id: string) {
  const found = items.find((entry) => entry.id === id);
  if (!found || found.type !== "item") throw new Error(`missing ${id}`);
  return found;
}

describe("tileMenuItems", () => {
  it("counts the whole selection when the clicked page is part of it and routes actions to the page", () => {
    const ctx = context({ selected: new Set(["p1", "p2"]) });
    const items = tileMenuItems("p2", ctx);
    expect(item(items, "extract").label).toBe("tools.pages.menu.extract:2");
    item(items, "rotate-left").onSelect();
    item(items, "label").onSelect();
    expect(ctx.onRotate).toHaveBeenCalledWith(-90);
    expect(ctx.onLabel).toHaveBeenCalledWith("p2");
  });

  it("disables the cut on the last page, viewer for other files and delete when it would empty the document", () => {
    const items = tileMenuItems("p3", context({ tiles: [page(1), page(3, "other")], selected: new Set(["p1", "p3"]) }));
    expect(item(items, "cut").disabled).toBe(true);
    expect(item(items, "viewer").disabled).toBe(true);
    expect(item(items, "delete").disabled).toBe(true);
    expect(item(items, "move").disabled).toBe(true);
  });

  it("offers to move the selection to a page number", () => {
    const ctx = context({ selected: new Set(["p1"]) });
    const move = item(tileMenuItems("p1", ctx), "move");
    expect(move.label).toBe("tools.pages.menu.move:1");
    move.onSelect();
    expect(ctx.onMove).toHaveBeenCalled();
  });

  it("offers to remove an existing cut and returns nothing for an unknown page", () => {
    expect(item(tileMenuItems("p1", context({ cuts: new Set(["p1"]) })), "cut").label).toBe("tools.pages.menu.removeCut");
    expect(tileMenuItems("missing", context())).toEqual([]);
  });
});
