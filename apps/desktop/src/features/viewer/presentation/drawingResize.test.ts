import { describe, expect, it } from "vitest";
import { cornerResize, stepResize } from "./drawingResize";

const AREA = { width: 800, height: 400 };
const BOX = { left: 200, top: 100, right: 400, bottom: 200 };

describe("cornerResize", () => {
  it("stretches each side freely from the opposite corner", () => {
    const resize = cornerResize(BOX, "nw", { x: 100, y: 80 }, false, AREA);

    expect(resize?.anchor).toEqual({ x: 400, y: 200 });
    expect(resize?.sx).toBeCloseTo(1.5);
    expect(resize?.sy).toBeCloseTo(1.2);
  });

  it("keeps the ratio when asked, stays on the page and never flips past the anchor", () => {
    expect(cornerResize(BOX, "se", { x: 500, y: 120 }, true, AREA)).toMatchObject({ sx: 1.5, sy: 1.5 });
    expect(cornerResize(BOX, "se", { x: 5000, y: 5000 }, true, AREA)).toMatchObject({ sx: 3, sy: 3 });
    const flipped = cornerResize(BOX, "se", { x: 0, y: 0 }, false, AREA);
    expect((flipped?.sx ?? 0) * 200).toBeCloseTo(12);
    expect((flipped?.sy ?? 0) * 100).toBeCloseTo(12);
  });

  it("scales a flat line evenly and gives up on a single dot", () => {
    const line = { left: 100, top: 200, right: 300, bottom: 200 };

    expect(cornerResize(line, "se", { x: 400, y: 260 }, false, AREA)).toMatchObject({ sx: 1.5, sy: 1.5 });
    expect(cornerResize({ left: 50, top: 50, right: 50, bottom: 50 }, "se", { x: 90, y: 90 }, false, AREA)).toBeNull();
  });
});

describe("stepResize", () => {
  it("grows and shrinks around the centre", () => {
    expect(stepResize(BOX, 1.15, AREA)).toMatchObject({ anchor: { x: 300, y: 150 }, sx: 1.15, sy: 1.15 });
    expect(stepResize(BOX, 1 / 1.15, AREA)?.sx).toBeCloseTo(1 / 1.15);
  });

  it("stops at the page edge and at the smallest size", () => {
    expect(stepResize({ left: 0, top: 100, right: 200, bottom: 200 }, 1.15, AREA)).toBeNull();
    expect(stepResize({ left: 100, top: 100, right: 112, bottom: 104 }, 0.5, AREA)).toBeNull();
  });
});
