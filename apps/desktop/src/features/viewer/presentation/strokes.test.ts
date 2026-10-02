import { describe, expect, it } from "vitest";
import type { Stroke } from "@/shared/store/presentationStore";
import { clampStrokePoint, readableOnDark, strokeCanvasBox } from "./strokes";
import { nearestPageRect, type PageRect } from "./usePageRects";

const stroke = (points: Array<[number, number]>): Stroke => ({ id: "s", tool: "pen", color: "#e11d48", width: 0.01, points: points.map(([x, y]) => ({ x, y })) });

describe("strokeCanvasBox", () => {
  it("covers the page when every stroke stays on it", () => {
    expect(strokeCanvasBox([stroke([[0.2, 0.2], [0.8, 0.8]])], 200, 300)).toEqual({ left: 0, top: 0, width: 200, height: 300 });
  });

  it("grows past the page edges to keep strokes that leave it", () => {
    const box = strokeCanvasBox([stroke([[0.5, 0.5], [1.4, -0.2]])], 200, 300);
    expect(box.left).toBe(0);
    expect(box.top).toBeLessThanOrEqual(-60);
    expect(box.left + box.width).toBeGreaterThanOrEqual(280);
    expect(box.top + box.height).toBe(300);
  });

  it("keeps a minimum size for an empty page", () => {
    expect(strokeCanvasBox([], 0, 0)).toEqual({ left: 0, top: 0, width: 1, height: 1 });
  });
});

describe("clampStrokePoint", () => {
  it("lets a point reach one page beyond each edge and no further", () => {
    expect(clampStrokePoint({ x: 1.5, y: -0.4 })).toEqual({ x: 1.5, y: -0.4 });
    expect(clampStrokePoint({ x: 9, y: -9 })).toEqual({ x: 2, y: -1 });
  });
});

describe("nearestPageRect", () => {
  const pages: PageRect[] = [
    { pageIndex: 0, left: 100, top: 0, width: 400, height: 500 },
    { pageIndex: 1, left: 100, top: 520, width: 400, height: 500 },
  ];

  it("picks the page under the point or the closest one beside it", () => {
    expect(nearestPageRect(pages, 300, 200)?.pageIndex).toBe(0);
    expect(nearestPageRect(pages, 20, 900)?.pageIndex).toBe(1);
    expect(nearestPageRect(pages, 300, 508)?.pageIndex).toBe(0);
  });

  it("returns nothing when no page is laid out", () => {
    expect(nearestPageRect([], 10, 10)).toBeNull();
  });
});

describe("readableOnDark", () => {
  it("swaps very dark ink for white and keeps bright colours", () => {
    expect(readableOnDark("#111827")).toBe("#ffffff");
    expect(readableOnDark("#facc15")).toBe("#facc15");
    expect(readableOnDark("red")).toBe("red");
  });
});
