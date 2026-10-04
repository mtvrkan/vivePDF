import { describe, expect, it } from "vitest";
import { createShape, createText, DEFAULT_DROP_SHADOW } from "../model/design";
import { dropShadowFilter, localShadowOffset } from "./dropShadow";

describe("canvas drop shadow", () => {
  it("draws the shadow as a CSS drop shadow with the blur and colour opacity", () => {
    const shape = { ...createShape("rect", 0, 0, 50, 50), dropShadow: { color: "#ff8000", opacity: 0.5, x: 4, y: -6, blur: 12 } };

    expect(dropShadowFilter(shape)).toBe("drop-shadow(4px -6px 12px rgba(255, 128, 0, 0.5))");
  });

  it("turns the offset back so the shadow keeps its page direction on a turned item", () => {
    const local = localShadowOffset({ x: 10, y: 0 }, 90);
    const shape = { ...createShape("rect", 0, 0, 50, 50), rotation: 90, dropShadow: { ...DEFAULT_DROP_SHADOW, x: 10, y: 0 } };

    expect(local.x).toBeCloseTo(0);
    expect(local.y).toBeCloseTo(-10);
    expect(dropShadowFilter(shape)).toMatch(/^drop-shadow\(0px -10px /);
  });

  it("adds no filter without a visible shadow or on text", () => {
    expect(dropShadowFilter(createShape("rect", 0, 0, 5, 5))).toBeUndefined();
    expect(dropShadowFilter({ ...createShape("rect", 0, 0, 5, 5), dropShadow: { ...DEFAULT_DROP_SHADOW, opacity: 0 } })).toBeUndefined();
    expect(dropShadowFilter(createText(0, 0, 5, 5, "a"))).toBeUndefined();
  });
});
