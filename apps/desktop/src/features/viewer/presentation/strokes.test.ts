import { describe, expect, it } from "vitest";
import type { Stroke } from "@/shared/store/presentationStore";
import { TEXT_LINE_HEIGHT, arrowHeadLength, clampStrokePoint, measureTextBlock, readableOnDark, strokeCanvasBox } from "./strokes";
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

describe("strokeCanvasBox for shapes and text", () => {
  it("leaves room for an arrow head past the page edge", () => {
    const arrow: Stroke = { id: "a", tool: "arrow", color: "#000000", width: 0.01, points: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }] };

    const box = strokeCanvasBox([arrow], 200, 100);

    expect(box.left + box.width).toBeGreaterThanOrEqual(200 + arrowHeadLength(2));
  });

  it("grows to hold text that runs past the page", () => {
    const label: Stroke = { id: "t", tool: "text", color: "#000000", width: 0, points: [{ x: 0.9, y: 0.9 }], text: "Hi", fontSize: 0.1, size: { width: 0.5, height: 0.2 } };

    const box = strokeCanvasBox([label], 200, 100);

    expect(box.left + box.width).toBeGreaterThanOrEqual(280);
    expect(box.top + box.height).toBeGreaterThanOrEqual(110);
  });
});

describe("measureTextBlock", () => {
  it("makes one line per break and keeps the widest line", () => {
    const single = measureTextBlock("abc", 20);
    const double = measureTextBlock("abc\nabcdef", 20);

    expect(double.height).toBe(Math.ceil(2 * 20 * TEXT_LINE_HEIGHT));
    expect(double.width).toBeGreaterThan(single.width);
  });
});
