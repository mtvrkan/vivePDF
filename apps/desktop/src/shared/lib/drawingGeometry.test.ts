import { describe, expect, it } from "vitest";
import type { Stroke } from "@/shared/store/presentationStore";
import { drawingBounds, hitsDrawing, topDrawingAt, translateDrawing } from "./drawingGeometry";

const SCALE = { x: 1000, y: 500 };

function shape(tool: Stroke["tool"], from: [number, number], to: [number, number], id: string = tool): Stroke {
  return { id, tool, color: "#000000", width: 0.004, points: [{ x: from[0], y: from[1] }, { x: to[0], y: to[1] }] };
}

const label: Stroke = { id: "label", tool: "text", color: "#000000", width: 0, points: [{ x: 0.1, y: 0.1 }], text: "Hi", fontSize: 0.02, size: { width: 0.05, height: 0.06 } };

describe("hitsDrawing", () => {
  it("finds a line, a rectangle edge and an ellipse edge in page pixels", () => {
    expect(hitsDrawing(shape("line", [0.1, 0.5], [0.5, 0.5]), { x: 0.3, y: 0.505 }, 2, { scale: SCALE })).toBe(true);
    expect(hitsDrawing(shape("rect", [0.2, 0.2], [0.4, 0.6]), { x: 0.4, y: 0.4 }, 2, { scale: SCALE })).toBe(true);
    expect(hitsDrawing(shape("ellipse", [0.2, 0.2], [0.4, 0.6]), { x: 0.2, y: 0.4 }, 2, { scale: SCALE })).toBe(true);
  });

  it("counts the inside of a rectangle or an ellipse only when asked for a filled hit", () => {
    const box = shape("rect", [0.2, 0.2], [0.4, 0.6]);
    const ring = shape("ellipse", [0.2, 0.2], [0.4, 0.6]);

    expect(hitsDrawing(box, { x: 0.3, y: 0.4 }, 2, { scale: SCALE })).toBe(false);
    expect(hitsDrawing(box, { x: 0.3, y: 0.4 }, 2, { scale: SCALE, filled: true })).toBe(true);
    expect(hitsDrawing(ring, { x: 0.3, y: 0.4 }, 2, { scale: SCALE, filled: true })).toBe(true);
    expect(hitsDrawing(ring, { x: 0.205, y: 0.21 }, 2, { scale: SCALE, filled: true })).toBe(false);
  });

  it("finds text anywhere in its box and misses beside it", () => {
    expect(hitsDrawing(label, { x: 0.12, y: 0.13 }, 2, { scale: SCALE })).toBe(true);
    expect(hitsDrawing(label, { x: 0.3, y: 0.13 }, 2, { scale: SCALE })).toBe(false);
  });
});

describe("drawingBounds", () => {
  it("spans a shape's corners plus half its line width", () => {
    expect(drawingBounds(shape("rect", [0.4, 0.6], [0.2, 0.2]), SCALE)).toEqual({ left: 198, top: 98, right: 402, bottom: 302 });
  });

  it("spans a text box from its anchor", () => {
    const bounds = drawingBounds(label, SCALE);

    expect([bounds.left, bounds.top, bounds.right, bounds.bottom].map(Math.round)).toEqual([100, 50, 150, 80]);
  });
});

describe("topDrawingAt", () => {
  it("picks the most recent drawing under the point and nothing on empty space", () => {
    const below = shape("rect", [0.1, 0.1], [0.5, 0.5], "below");
    const above = shape("rect", [0.2, 0.2], [0.4, 0.4], "above");

    expect(topDrawingAt([below, above], { x: 0.3, y: 0.3 }, 4, SCALE)?.id).toBe("above");
    expect(topDrawingAt([below, above], { x: 0.45, y: 0.45 }, 4, SCALE)?.id).toBe("below");
    expect(topDrawingAt([below, above], { x: 0.9, y: 0.9 }, 4, SCALE)).toBeNull();
  });
});

describe("translateDrawing", () => {
  it("moves every point and keeps the original untouched", () => {
    const original = shape("arrow", [0.1, 0.1], [0.3, 0.2]);

    const moved = translateDrawing(original, 0.1, -0.05);

    expect(moved.points[0].x).toBeCloseTo(0.2);
    expect(moved.points[0].y).toBeCloseTo(0.05);
    expect(moved.points[1].x).toBeCloseTo(0.4);
    expect(moved.points[1].y).toBeCloseTo(0.15);
    expect(original.points[0]).toEqual({ x: 0.1, y: 0.1 });
  });
});
