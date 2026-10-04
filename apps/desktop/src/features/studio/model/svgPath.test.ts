import { describe, expect, it } from "vitest";
import { ellipticRect, normalizePathData, primitivePath } from "./svgPath";

type Point = [number, number];

function commands(d: string): string[] {
  return d.match(/[A-Za-z]/g) ?? [];
}

function numbers(segment: string): number[] {
  return (segment.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

function cubicAt(from: Point, c1: Point, c2: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return [0, 1].map((axis) => u * u * u * from[axis] + 3 * u * u * t * c1[axis] + 3 * u * t * t * c2[axis] + t * t * t * to[axis]) as Point;
}

function cubicSamples(d: string): Point[] {
  const segments = d.match(/[MLCQZ][^MLCQZ]*/g) ?? [];
  let current: Point = [0, 0];
  const samples: Point[] = [];
  for (const segment of segments) {
    const values = numbers(segment);
    if (segment[0] === "C") {
      const c1: Point = [values[0], values[1]];
      const c2: Point = [values[2], values[3]];
      const to: Point = [values[4], values[5]];
      for (const t of [0.25, 0.5, 0.75]) samples.push(cubicAt(current, c1, c2, to, t));
      current = to;
    } else if (values.length >= 2) {
      current = [values[values.length - 2], values[values.length - 1]];
    }
  }
  return samples;
}

describe("svg path normalisation", () => {
  it("turns relative, horizontal and vertical commands into absolute lines", () => {
    expect(normalizePathData("m2 3h4v5l-1 1z")).toBe("M2 3 L6 3 L6 8 L5 9 Z");
    expect(normalizePathData("M1 1 2 2 3 3")).toBe("M1 1 L2 2 L3 3");
    expect(normalizePathData("m1 1 2 2")).toBe("M1 1 L3 3");
  });

  it("reflects smooth cubic and quadratic control points", () => {
    expect(normalizePathData("M0 0C1 1 2 1 3 0S5 -1 6 0")).toBe("M0 0 C1 1 2 1 3 0 C4 -1 5 -1 6 0");
    expect(normalizePathData("M0 0Q1 2 2 0T4 0")).toBe("M0 0 Q1 2 2 0 Q3 -2 4 0");
    expect(normalizePathData("M0 0s1 1 2 0")).toBe("M0 0 C0 0 1 1 2 0");
  });

  it("converts a half-circle arc into cubic curves that stay on the circle", () => {
    const d = normalizePathData("M2 12a10 10 0 0 1 20 0");
    expect(commands(d)).toEqual(["M", "C", "C"]);
    expect(d.endsWith("22 12")).toBe(true);
    for (const [x, y] of cubicSamples(d)) expect(Math.hypot(x - 12, y - 12)).toBeCloseTo(10, 2);
    for (const [, y] of cubicSamples(d)) expect(y).toBeLessThan(12.001);
  });

  it("reads packed arc flags and numbers the way Lucide writes them", () => {
    const d = normalizePathData("M3 3a.5.5 0 01.5.5");
    expect(commands(d)).toEqual(["M", "C"]);
    expect(d.endsWith("3.5 3.5")).toBe(true);
    expect(normalizePathData("M0 0a1 1 0 1 0 2 0")).toMatch(/^M0 0( C[^C]+){2}$/);
  });

  it("scales radii that are too small and draws degenerate arcs as lines or nothing", () => {
    const d = normalizePathData("M0 0A1 1 0 0 1 10 0");
    for (const [x, y] of cubicSamples(d)) expect(Math.hypot(x - 5, y)).toBeCloseTo(5, 2);
    expect(normalizePathData("M0 0A0 4 0 0 1 10 0")).toBe("M0 0 L10 0");
    expect(normalizePathData("M5 5A3 3 0 0 1 5 5")).toBe("M5 5");
  });

  it("keeps the subpath start after a close and only emits supported commands", () => {
    const d = normalizePathData("M10 10l5 0z l0 5");
    expect(d).toBe("M10 10 L15 10 Z L10 15");
    expect(new Set(commands(normalizePathData("M0 0h1v1H0V0zM2 2c1 1 1 1 2 2s1 1 2 2q1 1 2 2t2 2a1 1 0 0 0 2 2")))).toEqual(new Set(["M", "L", "Z", "C", "Q"]));
  });

  it("refuses data that does not start with a move or is incomplete", () => {
    expect(() => normalizePathData("L1 1")).toThrow();
    expect(() => normalizePathData("M1")).toThrow();
    expect(() => normalizePathData("M0 0A1 1 0 2 0 3 3")).toThrow();
    expect(normalizePathData("")).toBe("");
  });
});

describe("svg primitives as paths", () => {
  it("draws circles and ellipses as four curves", () => {
    const circle = primitivePath("circle", { cx: "12", cy: "12", r: "10" });
    expect(commands(circle)).toEqual(["M", "C", "C", "C", "C", "Z"]);
    expect(circle.startsWith("M12 2")).toBe(true);
    expect(primitivePath("ellipse", { cx: "5", cy: "5", rx: "4", ry: "2" }).startsWith("M5 3")).toBe(true);
    expect(primitivePath("circle", { cx: "1", cy: "1", r: "0" })).toBe("");
  });

  it("rounds rect corners with rx, ry or both and clamps them to half the side", () => {
    expect(primitivePath("rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" })).toBe(ellipticRect(2, 4, 20, 16, 2, 2));
    expect(primitivePath("rect", { width: "10", height: "10", ry: "3" })).toBe(ellipticRect(0, 0, 10, 10, 3, 3));
    expect(primitivePath("rect", { width: "10", height: "4", rx: "8", ry: "1" }).startsWith("M5 0")).toBe(true);
    expect(primitivePath("rect", { width: "6", height: "6" })).toBe("M0 0 L6 0 L6 6 L0 6 Z");
    expect(primitivePath("rect", { width: "0", height: "6" })).toBe("");
  });

  it("draws lines, polylines and closed polygons", () => {
    expect(primitivePath("line", { x1: "1", y1: "2", x2: "3", y2: "4" })).toBe("M1 2 L3 4");
    expect(primitivePath("polyline", { points: "1,2 3,4 5,6" })).toBe("M1 2 L3 4 L5 6");
    expect(primitivePath("polygon", { points: "0 0 4 0 2 3" })).toBe("M0 0 L4 0 L2 3 Z");
    expect(primitivePath("polygon", { points: "1" })).toBe("");
    expect(primitivePath("g", {})).toBe("");
  });
});
