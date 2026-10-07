import { describe, expect, it } from "vitest";
import { beginDrawing, extendDrawing, isDrawingKept, type DrawStyle } from "./drawingGestures";

const SURFACE = { width: 800, height: 400 };
const style = (tool: DrawStyle["tool"], overrides: Partial<DrawStyle> = {}): DrawStyle => ({ tool, color: "#E5484D", penWidth: 4, highlighterWidth: 20, penOpacity: 1, shapeKind: "rect", ...overrides });

describe("beginDrawing", () => {
  it("turns the picked pixel width into a share of the page width so 4 px draws 4 px", () => {
    const pen = beginDrawing(style("pen"), { x: 0.5, y: 0.5 }, SURFACE, "a");
    const marker = beginDrawing(style("highlighter"), { x: 0.5, y: 0.5 }, SURFACE, "b");

    expect(pen.width * SURFACE.width).toBeCloseTo(4);
    expect(marker.width * SURFACE.width).toBeCloseTo(20);
    expect(pen).not.toHaveProperty("opacity");
  });

  it("starts a shape of the picked kind with see-through ink", () => {
    const shape = beginDrawing(style("shape", { shapeKind: "ellipse", penOpacity: 0.5 }), { x: 0.2, y: 0.3 }, SURFACE, "c");

    expect(shape).toMatchObject({ tool: "ellipse", opacity: 0.5, points: [{ x: 0.2, y: 0.3 }, { x: 0.2, y: 0.3 }] });
  });
});

describe("extendDrawing", () => {
  it("adds points to a pen line and moves only the far corner of a shape", () => {
    const pen = extendDrawing(beginDrawing(style("pen"), { x: 0.1, y: 0.1 }, SURFACE), { x: 0.2, y: 0.2 }, SURFACE);
    const box = extendDrawing(extendDrawing(beginDrawing(style("shape"), { x: 0.1, y: 0.1 }, SURFACE), { x: 0.3, y: 0.3 }, SURFACE), { x: 0.4, y: 0.2 }, SURFACE);

    expect(pen.points).toHaveLength(2);
    expect(box.points).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.2 }]);
  });

  it("keeps a held-Shift rectangle square and a held-Shift arrow on 45 degree steps", () => {
    const square = extendDrawing(beginDrawing(style("shape"), { x: 0.1, y: 0.1 }, SURFACE), { x: 0.3, y: 0.15 }, SURFACE, true);
    const arrow = extendDrawing(beginDrawing(style("shape", { shapeKind: "arrow" }), { x: 0.5, y: 0.5 }, SURFACE), { x: 0.7, y: 0.52 }, SURFACE, true);

    const [start, end] = square.points;
    expect(Math.abs((end.x - start.x) * SURFACE.width)).toBeCloseTo(Math.abs((end.y - start.y) * SURFACE.height));
    expect(arrow.points[1].y).toBeCloseTo(0.5);
  });
});

describe("isDrawingKept", () => {
  it("drops a click without a drag and keeps a drawn shape", () => {
    const dot = beginDrawing(style("shape"), { x: 0.5, y: 0.5 }, SURFACE);
    const tap = beginDrawing(style("pen"), { x: 0.5, y: 0.5 }, SURFACE);

    expect(isDrawingKept(dot, SURFACE)).toBe(false);
    expect(isDrawingKept(tap, SURFACE)).toBe(false);
    expect(isDrawingKept(extendDrawing(dot, { x: 0.52, y: 0.5 }, SURFACE), SURFACE)).toBe(true);
  });
});
