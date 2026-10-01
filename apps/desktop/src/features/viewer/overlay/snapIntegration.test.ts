import { describe, expect, it } from "vitest";
import { computeSnappedRect } from "./snapIntegration";

describe("computeSnappedRect", () => {
  it("snaps to a nearby vertical candidate within tolerance", () => {
    const result = computeSnappedRect({ x: 102, y: 200, width: 50, height: 20 }, [100], [], 4, 4);
    expect(result.x).toBe(100);
    expect(result.guides.x).toEqual([100]);
  });

  it("does not snap when the nearest candidate is outside tolerance", () => {
    const result = computeSnappedRect({ x: 150, y: 200, width: 50, height: 20 }, [100], [], 4, 4);
    expect(result.x).toBe(150);
    expect(result.guides.x).toEqual([]);
  });

  it("snaps to the nearest of multiple candidates within range", () => {
    const result = computeSnappedRect({ x: 100, y: 200, width: 50, height: 20 }, [90, 102, 300], [], 4, 4);
    expect(result.x).toBe(102);
    expect(result.guides.x).toEqual([102]);
  });

  it("only reports guides for the axis that actually snapped", () => {
    const result = computeSnappedRect({ x: 102, y: 500, width: 50, height: 20 }, [100], [100], 4, 4);
    expect(result.guides.x).toEqual([100]);
    expect(result.guides.y).toEqual([]);
    expect(result.y).toBe(500);
  });
});
