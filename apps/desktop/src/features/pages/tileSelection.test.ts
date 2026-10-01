import { describe, expect, it } from "vitest";
import type { OrganizerTile } from "@/types";
import { clickSelection, spanSelection, tileClickMode } from "./tileSelection";

function page(index: number): OrganizerTile {
  return { key: `p${index}`, kind: "page", sourceId: "main", index, rotate: 0 };
}

const tiles = [page(1), page(2), page(3), page(4), page(5)];
const plain = { shiftKey: false, ctrlKey: false, metaKey: false };

describe("tileClickMode", () => {
  it("replaces on a plain click and toggles with Ctrl", () => {
    expect(tileClickMode(plain, false)).toBe("replace");
    expect(tileClickMode({ ...plain, ctrlKey: true }, false)).toBe("toggle");
  });

  it("toggles on a plain click in multi-select mode", () => {
    expect(tileClickMode(plain, true)).toBe("toggle");
  });

  it("extends instead of replacing with Shift in multi-select mode", () => {
    expect(tileClickMode({ ...plain, shiftKey: true }, false)).toBe("range");
    expect(tileClickMode({ ...plain, shiftKey: true }, true)).toBe("rangeAdd");
  });
});

describe("clickSelection", () => {
  it("selects only the clicked tile when replacing", () => {
    expect(clickSelection(tiles, new Set(["p1", "p2"]), "p1", "p4", "replace")).toEqual({ keys: ["p4"], anchor: "p4" });
  });

  it("adds and removes a tile when toggling", () => {
    expect(clickSelection(tiles, new Set(["p1"]), "p1", "p3", "toggle").keys).toEqual(["p1", "p3"]);
    expect(clickSelection(tiles, new Set(["p1", "p3"]), "p1", "p3", "toggle").keys).toEqual(["p1"]);
  });

  it("selects a range backwards from the anchor and keeps the anchor", () => {
    expect(clickSelection(tiles, new Set(["p4"]), "p4", "p2", "range")).toEqual({ keys: ["p2", "p3", "p4"], anchor: "p4" });
  });

  it("adds a range to what was already selected", () => {
    expect(clickSelection(tiles, new Set(["p1"]), "p3", "p5", "rangeAdd").keys).toEqual(["p1", "p3", "p4", "p5"]);
  });

  it("falls back when the anchor tile no longer exists", () => {
    expect(clickSelection(tiles, new Set(), "gone", "p2", "range")).toEqual({ keys: ["p2"], anchor: "p2" });
    expect(clickSelection(tiles, new Set(["p1"]), "gone", "p2", "rangeAdd").keys).toEqual(["p1", "p2"]);
  });
});

describe("spanSelection", () => {
  it("selects from the origin to the focus on top of what was selected before", () => {
    expect(spanSelection(tiles, new Set(["p1"]), "p2", 3)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("shrinks back when the focus returns towards the origin", () => {
    expect(spanSelection(tiles, new Set(["p2"]), "p2", 2)).toEqual(["p2", "p3"]);
    expect(spanSelection(tiles, new Set(["p2"]), "p2", 1)).toEqual(["p2"]);
  });

  it("keeps the earlier selection when the origin is gone", () => {
    expect(spanSelection(tiles, new Set(["p1"]), "gone", 2)).toEqual(["p1"]);
  });
});
