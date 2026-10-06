import { describe, expect, it } from "vitest";
import { eraseAlong, eraseAt, inkBounds, sameStrokes } from "./inkErase";

const line = (points: Array<[number, number]>) => ({ points: points.map(([x, y]) => ({ x, y })) });

describe("eraseAt", () => {
  it("cuts a stroke in two where the eraser crosses it", () => {
    expect(eraseAt([line([[0, 0], [100, 0]])], { x: 50, y: 0 }, 10)).toEqual([line([[0, 0], [40, 0]]), line([[60, 0], [100, 0]])]);
  });

  it("leaves strokes the eraser does not touch untouched", () => {
    const strokes = [line([[0, 0], [100, 0]])];
    expect(sameStrokes(eraseAt(strokes, { x: 50, y: 30 }, 10), strokes)).toBe(true);
  });

  it("removes a stroke and a dot that lie entirely under the eraser", () => {
    expect(eraseAt([line([[0, 0], [4, 0]]), line([[2, 2]])], { x: 2, y: 0 }, 10)).toEqual([]);
  });

  it("trims the end of a stroke", () => {
    expect(eraseAt([line([[0, 0], [50, 0], [100, 0]])], { x: 100, y: 0 }, 20)).toEqual([line([[0, 0], [50, 0], [80, 0]])]);
  });
});

describe("eraseAlong", () => {
  it("erases everything along the dragged path", () => {
    const result = eraseAlong([line([[0, 0], [100, 0]]), line([[0, 50], [100, 50]])], [{ x: 50, y: -20 }, { x: 50, y: 70 }], 5);
    const rounded = result.map((stroke) => ({ points: stroke.points.map((point) => ({ x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 })) }));

    expect(rounded).toEqual([line([[0, 0], [45, 0]]), line([[55, 0], [100, 0]]), line([[0, 50], [45, 50]]), line([[55, 50], [100, 50]])]);
  });

  it("returns the strokes as they were for an empty path", () => {
    const strokes = [line([[0, 0], [10, 0]])];
    expect(eraseAlong(strokes, [], 5)).toBe(strokes);
  });
});

describe("inkBounds", () => {
  it("wraps the remaining points with half the line width", () => {
    expect(inkBounds([line([[10, 20], [30, 5]])], 4)).toEqual({ origin: { x: 8, y: 3 }, size: { width: 24, height: 19 } });
  });

  it("has no bounds when nothing is left", () => {
    expect(inkBounds([], 2)).toBeNull();
  });
});
