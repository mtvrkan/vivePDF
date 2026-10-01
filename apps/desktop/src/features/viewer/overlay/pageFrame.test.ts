import { describe, expect, it } from "vitest";
import { frameSizePx, frameToLocal, frameToScreen, frameTransform, quarterTurns, screenToFrame, transformTurns, type QuarterTurns } from "./pageFrame";

function applyMatrix(matrix: string, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = matrix.replace(/matrix\(|\)/g, "").split(",").map(Number);
  return [a * x + c * y + e, b * x + d * y + f];
}

function rotateLocal(turns: QuarterTurns, width: number, height: number, x: number, y: number): [number, number] {
  if (turns === 1) return [height - y, x];
  if (turns === 2) return [width - x, height - y];
  if (turns === 3) return [y, width - x];
  return [x, y];
}

describe("quarterTurns", () => {
  it("normalises degrees and quarter counts", () => {
    expect(quarterTurns(90)).toBe(1);
    expect(quarterTurns(270)).toBe(3);
    expect(quarterTurns(-90)).toBe(3);
    expect(quarterTurns(2, "quarters")).toBe(2);
  });

  it("treats a full turn as upright", () => {
    expect(quarterTurns(360)).toBe(0);
    expect(quarterTurns(4, "quarters")).toBe(0);
  });
});

describe("frameTransform", () => {
  it("leaves an upright page untransformed", () => {
    expect(frameTransform(0, 400, 600)).toBeUndefined();
    expect(frameSizePx(0, 400, 600)).toEqual({ width: 400, height: 600 });
  });

  it.each([1, 2, 3] as QuarterTurns[])("undoes a page turned %i quarter(s) so the frame matches the visible page", (turns) => {
    const width = 466;
    const height = 662;
    const matrix = frameTransform(turns, width, height) as string;
    const frame = frameSizePx(turns, width, height);
    const corners: Array<[number, number]> = [
      [0, 0],
      [frame.width, 0],
      [0, frame.height],
      [frame.width, frame.height],
      [120, 45],
    ];
    for (const [x, y] of corners) {
      const [localX, localY] = applyMatrix(matrix, x, y);
      expect(localX).toBeGreaterThanOrEqual(0);
      expect(localX).toBeLessThanOrEqual(width);
      expect(localY).toBeGreaterThanOrEqual(0);
      expect(localY).toBeLessThanOrEqual(height);
      const [screenX, screenY] = rotateLocal(turns, width, height, localX, localY);
      expect(screenX).toBeCloseTo(x);
      expect(screenY).toBeCloseTo(y);
    }
    expect(frame.width).toBe(turns === 2 ? width : height);
  });
});

describe("frameToLocal", () => {
  it("keeps a point on an upright page where it is", () => {
    expect(frameToLocal(0, 400, 600, 30, 50)).toEqual({ x: 30, y: 50 });
  });

  it.each([1, 2, 3] as QuarterTurns[])("lands where the frame transform puts a point on a page turned %i quarter(s)", (turns) => {
    const width = 466;
    const height = 662;
    const matrix = frameTransform(turns, width, height) as string;
    for (const [x, y] of [
      [0, 0],
      [120, 45],
      [300, 10],
    ] as Array<[number, number]>) {
      const [localX, localY] = applyMatrix(matrix, x, y);
      const local = frameToLocal(turns, width, height, x, y);
      expect(local.x).toBeCloseTo(localX);
      expect(local.y).toBeCloseTo(localY);
    }
  });
});

describe("screenToFrame / frameToScreen", () => {
  const rect = { left: 100, top: 50, width: 300, height: 200 };

  it("maps screen points directly when the view is not turned", () => {
    expect(screenToFrame(130, 70, rect, 0)).toEqual({ x: 30, y: 20 });
  });

  it("maps screen points back into the frame of a view turned a quarter", () => {
    expect(screenToFrame(380, 60, rect, 1)).toEqual({ x: 10, y: 20 });
    expect(screenToFrame(110, 240, rect, 3)).toEqual({ x: 10, y: 10 });
  });

  it.each([0, 1, 2, 3] as QuarterTurns[])("round-trips a box for view turn %i", (turns) => {
    const box = { x: 20, y: 30, width: 40, height: 10 };
    const screen = frameToScreen(box, rect, turns);
    const corners = [screenToFrame(screen.left, screen.top, rect, turns), screenToFrame(screen.left + screen.width, screen.top + screen.height, rect, turns)];
    const xs = corners.map((point) => point.x).sort((a, b) => a - b);
    const ys = corners.map((point) => point.y).sort((a, b) => a - b);
    expect({ x: xs[0], y: ys[0], width: xs[1] - xs[0], height: ys[1] - ys[0] }).toEqual(box);
  });
});

describe("transformTurns", () => {
  it("reads the quarter turns of a computed rotation matrix", () => {
    expect(transformTurns("matrix(0, 1, -1, 0, 661.96, 0)")).toBe(1);
    expect(transformTurns("matrix(-1, 0, 0, -1, 400, 600)")).toBe(2);
    expect(transformTurns("matrix(0, -1, 1, 0, 0, 662)")).toBe(3);
  });

  it("treats a scale without rotation as upright", () => {
    expect(transformTurns("matrix(1.5, 0, 0, 1.5, 0, 0)")).toBe(0);
  });

  it("falls back to upright for none or an unreadable transform", () => {
    expect(transformTurns("none")).toBe(0);
    expect(transformTurns("matrix3d(1, 0, 0, 0)")).toBe(0);
    expect(transformTurns("matrix(a, b, c, d, e, f)")).toBe(0);
  });
});
