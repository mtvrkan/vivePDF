import { describe, expect, it } from "vitest";
import { SNAPSHOT_MAX_PIXELS, snapshotRect, snapshotScale } from "./snapshot";

describe("snapshotRect", () => {
  it("turns a dragged area into a page rectangle whichever way it was drawn", () => {
    expect(snapshotRect({ x0: 300, y0: 200, x1: 100, y1: 50 })).toEqual({ origin: { x: 100, y: 50 }, size: { width: 200, height: 150 } });
  });
});

describe("snapshotScale", () => {
  const rect = { origin: { x: 0, y: 0 }, size: { width: 400, height: 200 } };

  it("never renders below twice the page size and follows a higher zoom", () => {
    expect(snapshotScale(1, rect)).toBe(2);
    expect(snapshotScale(3, rect)).toBe(3);
    expect(snapshotScale(Number.NaN, rect)).toBe(2);
  });

  it("caps very large areas so the picture stays within the pixel budget", () => {
    const large = { origin: { x: 0, y: 0 }, size: { width: 5000, height: 100 } };
    expect(snapshotScale(4, large) * 5000).toBeLessThanOrEqual(SNAPSHOT_MAX_PIXELS);
  });
});
