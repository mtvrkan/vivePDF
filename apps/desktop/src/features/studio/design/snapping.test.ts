import { describe, expect, it } from "vitest";
import { buildSnapIndex, measureAround, nearestTarget, snapMove, snapPoint, snapPosition, snapResize } from "./snapping";

const page = { width: 500, height: 400 };

describe("smart guides", () => {
  it("snaps edges and centres to the page and other elements and draws the shared line", () => {
    const index = buildSnapIndex(page, [{ x: 300, y: 20, width: 50, height: 50 }]);

    const snapped = snapMove({ x: 203, y: 172, width: 100, height: 50 }, index, 4);

    expect(snapped.dx).toBe(-3);
    expect(snapped.dy).toBe(3);
    expect(snapped.lines).toEqual([
      { axis: "x", position: 250, from: 0, to: 400 },
      { axis: "x", position: 300, from: 20, to: 225 },
      { axis: "y", position: 200, from: 0, to: 500 },
    ]);
    expect(snapMove({ x: 120, y: 120, width: 10, height: 10 }, index, 4)).toEqual({ dx: 0, dy: 0, lines: [], spans: [] });
  });

  it("snaps to ruler guides and margins given as extra lines", () => {
    const index = buildSnapIndex(page, [], { x: [37], y: [250] });

    const snapped = snapMove({ x: 39, y: 100, width: 20, height: 20 }, index, 3);

    expect(snapped.dx).toBe(-2);
    expect(snapPosition(index, "y", 248, 3)).toBe(250);
    expect(snapPosition(index, "y", 240, 3)).toBe(240);
  });

  it("centres an element between two neighbours with equal gaps", () => {
    const index = buildSnapIndex(page, [
      { x: 0, y: 100, width: 50, height: 40 },
      { x: 200, y: 100, width: 50, height: 40 },
    ]);

    const snapped = snapMove({ x: 98, y: 300, width: 50, height: 40 }, index, 4);
    const between = snapMove({ x: 98, y: 110, width: 50, height: 40 }, index, 4);

    expect(snapped.spans).toEqual([]);
    expect(between.dx).toBe(2);
    expect(between.spans).toEqual([
      { axis: "x", from: 50, to: 100, at: 125 },
      { axis: "x", from: 150, to: 200, at: 125 },
    ]);
  });

  it("repeats the gap of a row and shows every equal gap of the chain", () => {
    const index = buildSnapIndex(page, [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
      { x: 60, y: 0, width: 20, height: 20 },
    ]);

    const snapped = snapMove({ x: 92, y: 300, width: 20, height: 20 }, index, 3);
    const row = snapMove({ x: 92, y: 0, width: 20, height: 20 }, index, 3);

    expect(snapped.dx).toBe(0);
    expect(row.dx).toBe(-2);
    expect(row.spans.map((span) => [span.from, span.to])).toEqual([
      [50, 60],
      [20, 30],
      [80, 90],
    ]);
  });

  it("prefers an exact alignment over a nearby equal gap", () => {
    const index = buildSnapIndex(page, [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
      { x: 61, y: 100, width: 20, height: 20 },
    ]);

    const snapped = snapMove({ x: 61, y: 5, width: 20, height: 20 }, index, 3);

    expect(snapped.dx).toBe(0);
    expect(snapped.spans).toEqual([]);
    expect(snapped.lines.some((line) => line.axis === "x" && line.position === 61)).toBe(true);
  });

  it("measures the distance to the nearest neighbours or else the page edges", () => {
    const index = buildSnapIndex(page, [{ x: 0, y: 100, width: 50, height: 40 }]);

    const spans = measureAround(index, { x: 80, y: 110, width: 20, height: 20 });

    expect(spans).toContainEqual({ axis: "x", from: 50, to: 80, at: 120 });
    expect(spans).toContainEqual({ axis: "x", from: 100, to: 500, at: 120 });
    expect(spans).toContainEqual({ axis: "y", from: 0, to: 110, at: 90 });
    expect(spans).toContainEqual({ axis: "y", from: 130, to: 400, at: 90 });
    expect(measureAround(index, { x: -30, y: -30, width: 600, height: 500 })).toEqual([]);
  });

  it("finds the nearest target quickly among many elements", () => {
    const boxes = Array.from({ length: 2000 }, (_, at) => ({ x: at * 7, y: (at * 13) % 400, width: 5, height: 5 }));
    const index = buildSnapIndex({ width: 14000, height: 400 }, boxes);

    const found = nearestTarget(index.x, 7001.2, 1.5);
    expect(found?.value).toBe(7000);
    expect(found?.offset).toBeCloseTo(-1.2);
    expect(nearestTarget(index.x, 7003.5, 0.2)).toBeNull();
  });
});

describe("resize snapping", () => {
  const index = buildSnapIndex(page, [{ x: 300, y: 50, width: 100, height: 100 }]);
  const start = { x: 100, y: 100, width: 100, height: 50, rotation: 0 };

  it("snaps the dragged edge to another element's edge", () => {
    const result = snapResize(start, "e", 97, 0, {}, index, 4);

    expect(result.box).toMatchObject({ x: 100, width: 200 });
    expect(result.lines).toEqual([{ axis: "x", position: 300, from: 50, to: 150 }]);
  });

  it("keeps the ratio on a corner while snapping", () => {
    const result = snapResize(start, "se", 98, 3, { keepRatio: true }, index, 4);

    expect(result.box.width).toBeCloseTo(200);
    expect(result.box.height).toBeCloseTo(100);
  });

  it("moves both sides when resizing from the centre", () => {
    const result = snapResize(start, "e", 48, 0, { fromCenter: true }, index, 4);

    expect(result.box.x + result.box.width).toBeCloseTo(250);
    expect(result.box.x).toBeCloseTo(50);
  });

  it("leaves turned boxes and far edges alone", () => {
    expect(snapResize({ ...start, rotation: 30 }, "e", 97, 0, {}, index, 4).lines).toEqual([]);
    expect(snapResize(start, "e", 40, 0, {}, index, 4)).toEqual({ box: { ...start, width: 140 }, lines: [] });
  });
});

describe("snapping a single point", () => {
  it("pulls a dragged line end onto nearby edges and reports the guide lines", () => {
    const index = buildSnapIndex(page, [{ x: 300, y: 20, width: 50, height: 50 }]);

    const snapped = snapPoint(index, { x: 302, y: 68 }, 5);

    expect(snapped).toMatchObject({ x: 300, y: 70 });
    expect(snapped.lines.map((line) => [line.axis, line.position])).toEqual([["x", 300], ["y", 70]]);
  });

  it("leaves a point alone when nothing is within reach", () => {
    expect(snapPoint(buildSnapIndex(page, []), { x: 123, y: 77 }, 4)).toEqual({ x: 123, y: 77, lines: [] });
  });
});
