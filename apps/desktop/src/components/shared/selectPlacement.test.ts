import { describe, expect, it } from "vitest";
import { computeSelectPlacement } from "./selectPlacement";

const viewport = { width: 1200, height: 800 };

describe("computeSelectPlacement", () => {
  it("keeps the list left-aligned to the trigger when there is room", () => {
    const placement = computeSelectPlacement({ left: 40, top: 100, bottom: 136, width: 160 }, viewport, 4);
    expect(placement.left).toBe(40);
    expect(placement.width).toBe(160);
    expect(placement.above).toBe(false);
  });

  it("aligns the list's right edge to the trigger's right edge in the right third of the viewport", () => {
    const placement = computeSelectPlacement({ left: 1100, top: 100, bottom: 136, width: 70 }, viewport, 4);
    expect(placement.left).toBe(1100 + 70 - 160);
  });

  it("never places the list closer than 8px to either viewport edge", () => {
    const nearRight = computeSelectPlacement({ left: 1195, top: 100, bottom: 136, width: 20 }, viewport, 4);
    expect(nearRight.left).toBe(viewport.width - nearRight.width - 8);
    const nearLeft = computeSelectPlacement({ left: -50, top: 100, bottom: 136, width: 20 }, viewport, 4);
    expect(nearLeft.left).toBe(8);
  });

  it("flips above the trigger when there is not enough space below", () => {
    const placement = computeSelectPlacement({ left: 40, top: 780, bottom: 790, width: 160 }, viewport, 10);
    expect(placement.above).toBe(true);
    expect(placement.top).toBe(780 - 6);
  });
});
