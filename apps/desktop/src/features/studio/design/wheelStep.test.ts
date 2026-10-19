import { describe, expect, it } from "vitest";
import { wheelStep } from "./wheelStep";

describe("wheelStep", () => {
  it("takes one full step for a mouse wheel notch either way", () => {
    expect(wheelStep(-100, 1.1)).toBeCloseTo(1.1);
    expect(wheelStep(100, 1.1)).toBeCloseTo(1 / 1.1);
  });

  it("takes a sliver of a step for the small deltas of a trackpad pinch", () => {
    const pinch = wheelStep(-4, 1.1);

    expect(pinch).toBeGreaterThan(1);
    expect(pinch).toBeLessThan(1.01);
  });

  it("never goes past one step for a fast fling", () => {
    expect(wheelStep(-900, 1.1)).toBeCloseTo(1.1);
    expect(wheelStep(0, 1.1)).toBe(1);
  });
});
