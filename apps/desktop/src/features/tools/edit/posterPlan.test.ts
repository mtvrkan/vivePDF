import { describe, expect, it } from "vitest";
import { posterGridOf, posterPlan, tileName, tileUsed, visiblePageSize, type PosterGrid, type PosterSettings } from "./posterPlan";

const grid: PosterGrid = { paper: "a4", orientation: "auto", columns: 2, rows: 2, margin: 0, overlap: 0 };

describe("posterPlan", () => {
  it("doubles an A4 page across a 2×2 grid of A4 sheets in portrait", () => {
    const plan = posterPlan({ width: 595, height: 842 }, grid);
    expect(plan?.landscape).toBe(false);
    expect(plan?.scale).toBeCloseTo(2);
    expect(plan?.widthMm).toBeCloseTo(419.9, 0);
  });

  it("turns the sheets for a wide page and centres the leftover space", () => {
    const plan = posterPlan({ width: 1000, height: 400 }, grid);
    expect(plan?.landscape).toBe(true);
    expect(plan?.placed.x).toBeCloseTo(0);
    expect(plan?.placed.y).toBeGreaterThan(0);
  });

  it("returns nothing for an empty page or margins that leave no printable area", () => {
    expect(posterPlan({ width: 0, height: 842 }, grid)).toBeNull();
    expect(posterPlan({ width: 595, height: 842 }, { ...grid, margin: 300 })).toBeNull();
  });

  it("counts every sheet when the page fills the grid", () => {
    const plan = posterPlan({ width: 595, height: 842 }, grid);
    expect(plan?.sheets).toBe(4);
    expect(plan?.thin).toBe(false);
  });

  it("leaves out sheets the page never reaches and flags thin edge strips", () => {
    const plan = posterPlan({ width: 1000, height: 100 }, { ...grid, orientation: "landscape", columns: 2, rows: 3 });
    expect(plan?.rowShares[0]).toBe(0);
    expect(plan?.rowShares[2]).toBe(0);
    expect(plan && tileUsed(plan, 0, 1)).toBe(true);
    expect(plan && tileUsed(plan, 0, 0)).toBe(false);
    expect(plan?.sheets).toBe(2);
    expect(plan?.thin).toBe(true);
  });

  it("flags a sliver even when every sheet holds something", () => {
    const plan = posterPlan({ width: 1000, height: 250 }, { ...grid, orientation: "portrait" });
    expect(plan?.sheets).toBe(4);
    expect(plan?.thin).toBe(true);
  });

  it("steps by the printable size minus the overlap", () => {
    const plan = posterPlan({ width: 595, height: 842 }, { ...grid, orientation: "portrait", margin: 10, overlap: 20 });
    expect(plan?.step).toEqual({ x: 555, y: 802 });
  });
});

describe("posterGridOf", () => {
  it("clamps the grid and converts millimetres to points", () => {
    const settings: PosterSettings = { paper: "a3", orientation: "portrait", columns: 40, rows: 0, marginMm: 25.4, overlapMm: 500, cutMarks: true, labels: false, pages: "" };
    expect(posterGridOf(settings)).toEqual({ paper: "a3", orientation: "portrait", columns: 10, rows: 1, margin: 72, overlap: 144 });
  });
});

describe("tileName", () => {
  it("names rows with letters and columns with numbers", () => {
    expect(tileName(0, 0)).toBe("A1");
    expect(tileName(2, 1)).toBe("B3");
    expect(tileName(0, 26)).toBe("AA1");
  });
});

describe("visiblePageSize", () => {
  it("keeps the turned size info.get reports, since it already follows the page's rotation", () => {
    expect(visiblePageSize({ width: 842, height: 595, rotation: 90 })).toEqual({ width: 842, height: 595 });
    expect(visiblePageSize({ width: 595, height: 842, rotation: 180 })).toEqual({ width: 595, height: 842 });
    expect(visiblePageSize(undefined)).toBeNull();
  });
});
