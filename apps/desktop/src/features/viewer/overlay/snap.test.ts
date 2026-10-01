import { describe, expect, it } from "vitest";
import { pageMarginCandidates, rectEdgeCandidates, snapValue } from "./snap";

describe("snapValue", () => {
  it("snaps to the nearest candidate within tolerance", () => {
    expect(snapValue(101, [100, 300], 4, 1)).toEqual({ value: 100, guide: 100 });
  });

  it("returns the original value unsnapped when nothing is within tolerance", () => {
    expect(snapValue(150, [100, 300], 4, 1)).toEqual({ value: 150, guide: null });
  });

  it("accounts for screen scale when converting tolerance to page units", () => {
    expect(snapValue(101, [100], 4, 2)).toEqual({ value: 100, guide: 100 });
    expect(snapValue(104, [100], 4, 0.5)).toEqual({ value: 100, guide: 100 });
  });
});

describe("pageMarginCandidates", () => {
  it("includes page edges, margins, and centre", () => {
    const candidates = pageMarginCandidates(600, 800, 36);
    expect(candidates).toContain(0);
    expect(candidates).toContain(36);
    expect(candidates).toContain(300);
    expect(candidates).toContain(564);
    expect(candidates).toContain(600);
  });
});

describe("rectEdgeCandidates", () => {
  it("returns start, centre, and end for the requested axis", () => {
    const rects = [{ x: 10, y: 20, width: 100, height: 50 }];
    expect(rectEdgeCandidates(rects, "x")).toEqual([10, 60, 110]);
    expect(rectEdgeCandidates(rects, "y")).toEqual([20, 45, 70]);
  });
});
