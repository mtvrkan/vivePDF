import { describe, expect, it } from "vitest";
import { pageOffsetBetween, scrollPositionOf, syncTargetOf } from "./syncMath";

describe("syncMath", () => {
  it("measures the position as the page index plus the scrolled fraction", () => {
    const position = scrollPositionOf(3, 198, 792);

    expect(position).toBeCloseTo(2.25);
  });

  it("keeps the page offset taken when sync was switched on", () => {
    const offset = pageOffsetBetween(3, 5);

    const target = syncTargetOf(scrollPositionOf(4, 396, 792), offset, 20);

    expect(target).toEqual({ pageNumber: 6, fraction: 0.5 });
  });

  it("maps back the other way with the negated offset", () => {
    const offset = pageOffsetBetween(3, 5);

    const target = syncTargetOf(scrollPositionOf(6, 0, 792), -offset, 20);

    expect(target).toEqual({ pageNumber: 4, fraction: 0 });
  });

  it("clamps to the first and last page of the other document", () => {
    const before = syncTargetOf(0.5, -3, 10);
    const after = syncTargetOf(8.5, 4, 10);

    expect(before).toEqual({ pageNumber: 1, fraction: 0 });
    expect(after).toEqual({ pageNumber: 10, fraction: 0 });
  });

  it("clamps the fraction of a page and ignores pages without height", () => {
    expect(scrollPositionOf(2, 900, 792)).toBeLessThan(2);
    expect(scrollPositionOf(2, -10, 792)).toBe(1);
    expect(scrollPositionOf(2, 100, 0)).toBe(1);
  });

  it("returns nothing for an empty document", () => {
    const target = syncTargetOf(1, 0, 0);

    expect(target).toBeNull();
  });
});
