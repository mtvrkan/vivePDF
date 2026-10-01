import { describe, expect, it } from "vitest";
import {
  EMPTY_CORNER_STATE,
  clampCorner,
  cornerParams,
  cornersFor,
  hasCorners,
  nudgeCorner,
  pointFromClient,
  sameCorners,
  withFrameCorners,
  withPhotoState,
  type Corner,
} from "./cornerGeometry";

const square: Corner[] = [[10, 10], [190, 10], [190, 90], [10, 90]];

describe("corner geometry", () => {
  it("maps a pointer position on the shown preview back to photo pixels", () => {
    expect(pointFromClient(150, 75, { left: 100, top: 50, width: 100, height: 50 }, 2000, 1000)).toEqual([1000, 500]);
    expect(pointFromClient(90, 200, { left: 100, top: 50, width: 100, height: 50 }, 2000, 1000)).toEqual([0, 999]);
  });

  it("moves one handle with the arrow keys and a larger step with shift", () => {
    expect(nudgeCorner(square, 1, "ArrowRight", false, 200, 100)?.[1]).toEqual([191, 10]);
    expect(nudgeCorner(square, 2, "ArrowDown", true, 200, 100)?.[2]).toEqual([190, 92.5]);
    expect(nudgeCorner(square, 0, "ArrowLeft", true, 200, 100)?.[0]).toEqual([5, 10]);
    expect(nudgeCorner(square, 0, "Enter", false, 200, 100)).toBeNull();
  });

  it("keeps handles inside the photo", () => {
    expect(clampCorner([-5, 400], 200, 100)).toEqual([0, 99]);
    expect(nudgeCorner([[0, 0], ...square.slice(1)], 0, "ArrowUp", true, 200, 100)?.[0]).toEqual([0, 0]);
  });

  it("stores, replaces and clears the corners of one photo only", () => {
    const first = "D:/Fotoğraflar/fiş 1.jpg";
    const state = { all: square, frames: {} };
    const stored = withPhotoState({}, first, state);
    expect(stored).toEqual({ [first]: state });
    const both = withPhotoState(stored, "b.jpg", state);
    expect(Object.keys(withPhotoState(both, "b.jpg", null))).toEqual([first]);
    expect(Object.keys(withPhotoState(both, "b.jpg", EMPTY_CORNER_STATE))).toEqual([first]);
  });

  it("keeps corners for all frames apart from one frame's own corners", () => {
    const other: Corner[] = [[0, 0], [50, 0], [50, 40], [0, 40]];
    const shared = withFrameCorners(EMPTY_CORNER_STATE, 0, true, square);
    const own = withFrameCorners(shared, 2, false, other);
    expect(cornersFor(own, 2, false)).toEqual(other);
    expect(cornersFor(own, 1, false)).toEqual(square);
    expect(cornersFor(own, 2, true)).toEqual(square);
    expect(withFrameCorners(own, 2, false, null).frames).toEqual({});
    expect(withFrameCorners(own, 0, true, other)).toEqual({ all: other, frames: {} });
    expect(hasCorners(EMPTY_CORNER_STATE)).toBe(false);
  });

  it("builds one entry per photo for the engine", () => {
    const other: Corner[] = [[0, 0], [50, 0], [50, 40], [0, 40]];
    const record = { "a.tif": { all: square, frames: { 2: other } }, "c.jpg": { all: square, frames: {} } };
    expect(cornerParams(["a.tif", "b.jpg", "c.jpg"], record)).toEqual({
      corners: [square, null, square],
      frameCorners: [[null, null, other], null, null],
    });
    expect(cornerParams(["b.jpg"], record)).toEqual({ corners: undefined, frameCorners: undefined });
  });

  it("treats sub-pixel differences as the same corners", () => {
    expect(sameCorners(square, square.map(([x, y]) => [x + 0.2, y] as Corner))).toBe(true);
    expect(sameCorners(square, null)).toBe(false);
    expect(sameCorners(null, null)).toBe(true);
  });
});

describe("shared corners on frames of different sizes", () => {
  it("scales corners drawn on one frame to the size of another", () => {
    const state = withFrameCorners(EMPTY_CORNER_STATE, 0, true, square, [200, 100]);
    expect(cornersFor(state, 1, true, [100, 50])).toEqual([[5, 5], [95, 5], [95, 45], [5, 45]]);
    expect(cornersFor(state, 0, true, [200, 100])).toEqual(square);
  });

  it("keeps the drawing size when a single frame gets its own corners", () => {
    const shared = withFrameCorners(EMPTY_CORNER_STATE, 0, true, square, [200, 100]);
    const next = withFrameCorners(shared, 2, false, square, [400, 200]);
    expect(next.allSize).toEqual([200, 100]);
    expect(cornersFor(next, 1, false, [400, 200])).toEqual([[20, 20], [380, 20], [380, 180], [20, 180]]);
  });

  it("sends the drawing size with the shared corners", () => {
    const state = withFrameCorners(EMPTY_CORNER_STATE, 0, true, square, [200, 100]);
    expect(cornerParams(["a.tif", "b.jpg"], { "a.tif": state }).cornerSizes).toEqual([[200, 100], null]);
  });
});
