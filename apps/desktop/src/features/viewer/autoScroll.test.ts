import { describe, expect, it } from "vitest";
import { isAutoScrollToggle, reachedEnd, scrollDistance, splitWhole } from "./autoScroll";

describe("scrollDistance", () => {
  it("moves at the given speed for the time that passed", () => {
    expect(scrollDistance(50, 200)).toBe(10);
    expect(scrollDistance(120, 16)).toBeCloseTo(1.92);
  });

  it("does not jump after a long pause and ignores bad time steps", () => {
    expect(scrollDistance(100, 5000)).toBe(25);
    expect(scrollDistance(100, -4)).toBe(0);
    expect(scrollDistance(100, Number.NaN)).toBe(0);
  });
});

describe("reachedEnd", () => {
  it("stops at the bottom going forward and at the top going back", () => {
    expect(reachedEnd({ position: 900, size: 1500, viewport: 600 }, false)).toBe(true);
    expect(reachedEnd({ position: 500, size: 1500, viewport: 600 }, false)).toBe(false);
    expect(reachedEnd({ position: 0, size: 1500, viewport: 600 }, true)).toBe(true);
    expect(reachedEnd({ position: 10, size: 1500, viewport: 600 }, true)).toBe(false);
  });
});

describe("splitWhole", () => {
  it("keeps the fraction for the next frame", () => {
    expect(splitWhole(2.75)).toEqual({ whole: 2, rest: 0.75 });
    expect(splitWhole(0.25)).toEqual({ whole: 0, rest: 0.25 });
  });
});

describe("isAutoScrollToggle", () => {
  const keys = { ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: "H" };

  it("answers Ctrl+Shift+H and its Command variant", () => {
    expect(isAutoScrollToggle(keys)).toBe(true);
    expect(isAutoScrollToggle({ ...keys, ctrlKey: false, metaKey: true, key: "h" })).toBe(true);
  });

  it("ignores the combination without Shift or with Alt", () => {
    expect(isAutoScrollToggle({ ...keys, shiftKey: false })).toBe(false);
    expect(isAutoScrollToggle({ ...keys, altKey: true })).toBe(false);
    expect(isAutoScrollToggle({ ...keys, key: "j" })).toBe(false);
  });
});
