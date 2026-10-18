import { describe, expect, it } from "vitest";
import type { Stroke } from "@/shared/store/presentationStore";
import { BOARD_SIZES, boardStyleTool, clampBoardSize, stepBoardSize } from "./boardPresets";
import { clampSelectionOffset, mergeSelection, rectFromPoints, removeStrokes, segmentCrossesRect, selectionBounds, strokesInRect, toggleInSelection, translateStrokes } from "./boardSelection";

const size = { width: 1000, height: 500 };

function stroke(id: string, points: Array<[number, number]>, width = 0.004): Stroke {
  return { id, tool: "pen", color: "#ffffff", width, points: points.map(([x, y]) => ({ x, y })) };
}

describe("strokesInRect", () => {
  it("selects strokes with a point inside or a segment crossing the rectangle", () => {
    const strokes = [
      stroke("inside", [
        [0.2, 0.2],
        [0.25, 0.25],
      ]),
      stroke("crossing", [
        [0.1, 0.35],
        [0.9, 0.35],
      ]),
      stroke("outside", [
        [0.6, 0.6],
        [0.9, 0.9],
      ]),
    ];
    const rect = rectFromPoints({ x: 0.4, y: 0.4 }, { x: 0.15, y: 0.15 });
    expect(rect).toEqual({ left: 0.15, top: 0.15, right: 0.4, bottom: 0.4 });
    expect(strokesInRect(strokes, rect)).toEqual(["inside", "crossing"]);
  });

  it("picks shapes by their outline and inserted items by their box", () => {
    const frame: Stroke = { id: "rect", tool: "rect", color: "#ffffff", width: 0.004, points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }] };
    const item: Stroke = { id: "item", tool: "drawing", color: "#ffffff", width: 0, points: [{ x: 0.45, y: 0.45 }], size: { width: 0.2, height: 0.2 } };
    expect(strokesInRect([frame, item], { left: 0.4, top: 0.4, right: 0.5, bottom: 0.5 })).toEqual(["item"]);
    expect(strokesInRect([frame, item], { left: 0.05, top: 0.4, right: 0.15, bottom: 0.5 })).toEqual(["rect"]);
  });

  it("clips segments against every edge", () => {
    const rect = { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 };
    expect(segmentCrossesRect({ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, rect)).toBe(true);
    expect(segmentCrossesRect({ x: 0, y: 0 }, { x: 1, y: 1 }, rect)).toBe(true);
    expect(segmentCrossesRect({ x: 0, y: 0.3 }, { x: 1, y: 0.3 }, rect)).toBe(false);
    expect(segmentCrossesRect({ x: 0, y: 1 }, { x: 0.3, y: 0.65 }, rect)).toBe(false);
  });
});

describe("selection editing", () => {
  const strokes = [stroke("a", [[0.1, 0.1], [0.2, 0.3]], 0.01), stroke("b", [[0.6, 0.6], [0.7, 0.7]])];

  it("frames the selected strokes including their width", () => {
    const bounds = selectionBounds(strokes, ["a"], size);
    expect(bounds?.left).toBeCloseTo(0.095);
    expect(bounds?.right).toBeCloseTo(0.205);
    expect(bounds?.top).toBeCloseTo(0.09);
    expect(bounds?.bottom).toBeCloseTo(0.31);
    expect(selectionBounds(strokes, [], size)).toBeNull();
  });

  it("moves only the selected strokes and keeps the selection centre on the board", () => {
    const moved = translateStrokes(strokes, ["b"], 0.1, -0.2);
    expect(moved[0]).toBe(strokes[0]);
    expect(moved[1].points[0].x).toBeCloseTo(0.7);
    expect(moved[1].points[0].y).toBeCloseTo(0.4);
    expect(translateStrokes(strokes, [], 0.1, 0.1)).toBe(strokes);
    const offset = clampSelectionOffset({ left: 0.6, top: 0.6, right: 0.8, bottom: 0.8 }, 0.9, -0.9);
    expect(offset.x).toBeCloseTo(0.3);
    expect(offset.y).toBeCloseTo(-0.7);
  });

  it("removes selected strokes and keeps the same list when nothing matches", () => {
    expect(removeStrokes(strokes, ["a"]).map((entry) => entry.id)).toEqual(["b"]);
    expect(removeStrokes(strokes, ["zzz"])).toBe(strokes);
  });

  it("replaces, extends or toggles the selection", () => {
    expect(mergeSelection(["a"], ["b"], false)).toEqual(["b"]);
    expect(mergeSelection(["a"], ["a", "b"], true)).toEqual(["a", "b"]);
    expect(toggleInSelection(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleInSelection(["b"], "a")).toEqual(["b", "a"]);
  });
});

describe("board sizes", () => {
  it("steps through the presets and stops at the ends", () => {
    expect(stepBoardSize("pen", 4, 1)).toBe(6);
    expect(stepBoardSize("pen", 7, -1)).toBe(6);
    expect(stepBoardSize("pen", 16, 1)).toBe(16);
    expect(stepBoardSize("pen", 20, 1)).toBe(20);
    expect(stepBoardSize("eraser", 24, -1)).toBe(24);
    expect(stepBoardSize("eraser", 12, -1)).toBe(12);
  });

  it("clamps slider values into the tool's range", () => {
    expect(clampBoardSize("highlighter", 2)).toBe(BOARD_SIZES.highlighter.min);
    expect(clampBoardSize("pen", 999)).toBe(BOARD_SIZES.pen.max);
    expect(clampBoardSize("eraser", 41.6)).toBe(42);
  });

  it("styles shapes with the pen and has no size for the other tools", () => {
    expect(boardStyleTool("shape")).toBe("pen");
    expect(boardStyleTool("eraser")).toBe("eraser");
    expect(boardStyleTool("select")).toBeNull();
  });
});
