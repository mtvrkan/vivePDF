import { describe, expect, it } from "vitest";
import { columnCount, dropIndexAt, gridHeight, gridMetrics, indexesNear, mirrorBox, revealOffset, rowsRange, sameRowWindow, tileBox } from "./gridGeometry";

const metrics = gridMetrics(10, 440, 100, 150, 12);

describe("gridMetrics", () => {
  it("fits as many columns as auto-fill would and stretches them to the width", () => {
    expect(metrics.columns).toBe(4);
    expect(metrics.columnWidth).toBe(101);
    expect(gridHeight(metrics)).toBe(3 * 162 - 12);
  });

  it("keeps one column of the minimum width when the grid is narrower than a tile", () => {
    expect(columnCount(60, 100, 12)).toBe(1);
    expect(columnCount(0, 100, 12)).toBe(1);
    expect(gridMetrics(3, 60, 100, 150, 12).columnWidth).toBe(100);
  });

  it("has no height without tiles", () => {
    expect(gridHeight(gridMetrics(0, 440, 100, 150, 12))).toBe(0);
  });
});

describe("sameRowWindow", () => {
  const metrics = gridMetrics(400, 800, 180, 200, 20);

  it("treats a scroll inside the same row as no change", () => {
    expect(sameRowWindow(metrics, 880, 900, 600, 3)).toBe(true);
  });

  it("reports a change once the scroll crosses into another row", () => {
    expect(sameRowWindow(metrics, 880, 880 + 220, 600, 3)).toBe(false);
  });

  it("treats an empty grid as unchanged wherever it scrolls", () => {
    expect(sameRowWindow(gridMetrics(0, 800, 180, 200, 20), 0, 5000, 600, 3)).toBe(true);
  });
});

describe("rowsRange", () => {
  const large = gridMetrics(10_000, 440, 100, 150, 12);

  it("renders only the rows in view plus the overscan, starting on a row boundary", () => {
    expect(rowsRange(large, 1620, 1620 + 400, 2)).toEqual({ start: 8 * 4, end: 15 * 4 });
  });

  it("clamps to the first and last rows", () => {
    expect(rowsRange(large, 0, 300, 3)).toEqual({ start: 0, end: 5 * 4 });
    expect(rowsRange(large, 2500 * 162, 2500 * 162 + 400, 3)).toEqual({ start: 2497 * 4, end: 10_000 });
  });

  it("renders nothing for an empty view or an empty grid", () => {
    expect(rowsRange(large, 100, 100, 3)).toEqual({ start: 0, end: 0 });
    expect(rowsRange(gridMetrics(0, 440, 100, 150, 12), 0, 400, 3)).toEqual({ start: 0, end: 0 });
  });
});

describe("tile geometry", () => {
  it("places tiles row by row", () => {
    expect(tileBox(metrics, 5)).toEqual({ left: 113, top: 162, width: 101, height: 150 });
  });

  it("mirrors boxes for right-to-left layouts", () => {
    expect(mirrorBox(metrics, tileBox(metrics, 0))).toEqual({ left: 339, top: 0, width: 101, height: 150 });
  });

  it("lists the cells a box spans, skipping cells past the last tile", () => {
    expect(indexesNear(metrics, { left: 50, top: 100, width: 100, height: 100 })).toEqual([0, 1, 4, 5]);
    expect(indexesNear(metrics, { left: 0, top: 330, width: 440, height: 50 })).toEqual([8, 9]);
    expect(indexesNear(metrics, { left: 0, top: 0, width: -1, height: 10 })).toEqual([]);
  });
});

describe("dropIndexAt", () => {
  it("drops before a tile left of its centre and after it right of the centre", () => {
    expect(dropIndexAt(metrics, 20, 170)).toBe(4);
    expect(dropIndexAt(metrics, 90, 170)).toBe(5);
  });

  it("drops at the end past the last tile of a short final row", () => {
    expect(dropIndexAt(metrics, 400, 340)).toBe(10);
    expect(dropIndexAt(metrics, 400, 5000)).toBe(10);
  });

  it("drops at the start above the grid and at zero for an empty grid", () => {
    expect(dropIndexAt(metrics, -30, -200)).toBe(0);
    expect(dropIndexAt(gridMetrics(0, 440, 100, 150, 12), 10, 10)).toBe(0);
  });
});

describe("revealOffset", () => {
  it("scrolls only as far as needed to bring a tile into view", () => {
    expect(revealOffset(0, 500, 100, 150, 16)).toBeNull();
    expect(revealOffset(0, 500, 600, 150, 16)).toBe(266);
    expect(revealOffset(800, 500, 300, 150, 16)).toBe(284);
    expect(revealOffset(100, 500, 10, 150, 16)).toBe(0);
  });
});
