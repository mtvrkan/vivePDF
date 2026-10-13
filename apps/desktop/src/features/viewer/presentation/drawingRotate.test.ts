import { describe, expect, it } from "vitest";
import { drawingExtent } from "@/shared/lib/drawingGeometry";
import type { Stroke } from "@/shared/store/presentationStore";
import { duplicateDrawing, QUARTER_TURN, rotateDrawing, ROTATE_SNAP, snapAngle } from "./drawingRotate";

const SCALE = { x: 800, y: 400 };

function closeTo(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
}

describe("rotateDrawing", () => {
  it("turns a line a quarter clockwise around its centre in page pixels", () => {
    const line: Stroke = { id: "a", tool: "line", color: "#000000", width: 0.005, points: [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }] };

    const turned = rotateDrawing(line, QUARTER_TURN, SCALE);

    expect(turned.tool).toBe("line");
    closeTo(turned.points[0], { x: 0.375, y: 0.25 });
    closeTo(turned.points[1], { x: 0.375, y: 0.75 });
  });

  it("keeps a rectangle a rectangle on a quarter turn and swaps its sides", () => {
    const box: Stroke = { id: "b", tool: "rect", color: "#000000", width: 0.005, points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }] };

    const turned = rotateDrawing(box, QUARTER_TURN, SCALE);

    expect(turned.tool).toBe("rect");
    const extent = drawingExtent(turned, SCALE);
    expect(extent.left).toBeCloseTo(250);
    expect(extent.right).toBeCloseTo(350);
    expect(extent.top).toBeCloseTo(50);
    expect(extent.bottom).toBeCloseTo(250);
  });

  it("turns a rectangle at a slant into a closed outline that keeps its style", () => {
    const box: Stroke = { id: "c", tool: "rect", color: "#ff0000", width: 0.005, opacity: 0.5, points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }] };

    const turned = rotateDrawing(box, Math.PI / 4, SCALE);

    expect(turned).toMatchObject({ id: "c", tool: "pen", color: "#ff0000", width: 0.005, opacity: 0.5 });
    expect(turned.points).toHaveLength(5);
    closeTo(turned.points[4], turned.points[0]);
  });

  it("leaves text and a zero turn untouched", () => {
    const label: Stroke = { id: "d", tool: "text", color: "#000000", width: 0, points: [{ x: 0.1, y: 0.1 }], text: "Hi", fontSize: 0.04, size: { width: 0.1, height: 0.1 } };
    const pen: Stroke = { id: "e", tool: "pen", color: "#000000", width: 0.005, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] };

    expect(rotateDrawing(label, QUARTER_TURN, SCALE)).toBe(label);
    expect(rotateDrawing(pen, 0, SCALE)).toBe(pen);
  });
});

describe("snapAngle", () => {
  it("rounds to the nearest 15 degree step", () => {
    expect(snapAngle(0.3)).toBeCloseTo(ROTATE_SNAP);
    expect(snapAngle(0.4)).toBeCloseTo(ROTATE_SNAP * 2);
    expect(snapAngle(-0.1)).toBeCloseTo(0);
  });
});

describe("duplicateDrawing", () => {
  it("copies a drawing a little down and right under a new id", () => {
    const pen: Stroke = { id: "f", tool: "pen", color: "#0000ff", width: 0.005, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] };

    const copy = duplicateDrawing(pen, SCALE);

    expect(copy.id).not.toBe("f");
    expect(copy.color).toBe("#0000ff");
    closeTo(copy.points[0], { x: 0.12, y: 0.14 });
    closeTo(copy.points[1], { x: 0.22, y: 0.24 });
  });
});
