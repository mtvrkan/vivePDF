import { describe, expect, it } from "vitest";
import { computeToolbarPlacement } from "./toolbarPlacement";

const VIEWPORT = { width: 1200, height: 800 };
const TOOLBAR = { width: 260, height: 40 };

describe("computeToolbarPlacement", () => {
  it("positions above the selection when there is room", () => {
    const selectionRect = { top: 300, left: 500, width: 100, height: 100 };
    const placement = computeToolbarPlacement(selectionRect, TOOLBAR, VIEWPORT);
    expect(placement.flipped).toBe(false);
    expect(placement.top).toBeLessThan(selectionRect.top);
  });

  it("flips below the selection when there is no room above", () => {
    const selectionRect = { top: 10, left: 500, width: 100, height: 100 };
    const placement = computeToolbarPlacement(selectionRect, TOOLBAR, VIEWPORT);
    expect(placement.flipped).toBe(true);
    expect(placement.top).toBeGreaterThan(selectionRect.top + selectionRect.height);
  });

  it("clamps left so the toolbar never overflows the left edge", () => {
    const selectionRect = { top: 300, left: 5, width: 20, height: 20 };
    const placement = computeToolbarPlacement(selectionRect, TOOLBAR, VIEWPORT);
    expect(placement.left).toBeGreaterThanOrEqual(0);
  });

  it("clamps left so the toolbar never overflows the right edge", () => {
    const selectionRect = { top: 300, left: VIEWPORT.width - 20, width: 20, height: 20 };
    const placement = computeToolbarPlacement(selectionRect, TOOLBAR, VIEWPORT);
    expect(placement.left + TOOLBAR.width).toBeLessThanOrEqual(VIEWPORT.width);
  });
});
