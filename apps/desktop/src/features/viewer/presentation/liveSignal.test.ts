import { describe, expect, it } from "vitest";
import { fromLivePoint, liveScale, toLivePoint } from "./liveSignal";

const RECTS = [
  { pageIndex: 0, left: 100, top: 0, width: 400, height: 300 },
  { pageIndex: 1, left: 100, top: 320, width: 400, height: 300 },
];

describe("liveSignal", () => {
  it("maps a stage point to the page under it and back to another screen size", () => {
    const point = toLivePoint(RECTS, 300, 470);

    expect(point).toEqual({ pageIndex: 1, x: 0.5, y: 0.5 });
    expect(fromLivePoint([{ pageIndex: 1, left: 0, top: 0, width: 1600, height: 1200 }], point!)).toEqual({ x: 800, y: 600 });
  });

  it("keeps a point in the letterbox relative to the nearest page instead of clamping it", () => {
    const point = toLivePoint(RECTS, 50, 150);

    expect(point).toEqual({ pageIndex: 0, x: -0.125, y: 0.5 });
  });

  it("gives nothing when no page is laid out or the page is not on the other screen", () => {
    expect(toLivePoint([], 10, 10)).toBeNull();
    expect(fromLivePoint(RECTS, { pageIndex: 7, x: 0.5, y: 0.5 })).toBeNull();
  });

  it("scales pixel sizes by the ratio of the page widths", () => {
    const audience = [{ pageIndex: 0, left: 0, top: 0, width: 1200, height: 900 }];

    expect(liveScale(audience, { pageWidth: 400, pointer: { pageIndex: 0, x: 0, y: 0 } })).toBe(3);
    expect(liveScale(audience, { pageWidth: 0, pointer: null })).toBe(1);
    expect(liveScale([], { pageWidth: 400, pointer: null })).toBe(1);
  });
});
