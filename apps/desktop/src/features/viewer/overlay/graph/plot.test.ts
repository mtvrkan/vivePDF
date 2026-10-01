import { describe, expect, it } from "vitest";
import { isFinitePrimitive } from "../shapes/primitives";
import { autoRange, curvePieces, DEFAULT_GRAPH, niceStep, planGraph, PLOT_HEIGHT, PLOT_WIDTH, tickLatex, ticks, validRange } from "./plot";

describe("ranges and ticks", () => {
  it("steps in 1, 2, 2.5 and 5 of a power of ten", () => {
    expect(niceStep(10, 7)).toBe(2);
    expect(niceStep(1, 5)).toBeCloseTo(0.2);
    expect(niceStep(100, 4)).toBe(25);
    expect(niceStep(7000, 7)).toBe(1000);
  });

  it("lists the ticks inside the range and writes them without float noise", () => {
    expect(ticks({ min: -5, max: 5 }, 7).values).toEqual([-4, -2, 0, 2, 4]);
    expect(tickLatex(0.30000000000000004, 0.1)).toBe("0.3");
    expect(tickLatex(-0.0000001, 0.5)).toBe("0.0");
    expect(tickLatex(-2, 1)).toBe("-2");
    expect(tickLatex(2.5, 2.5)).toBe("2.5");
  });

  it("repairs reversed, empty or broken ranges", () => {
    expect(validRange(5, -5)).toEqual({ min: -5, max: 5 });
    expect(validRange(2, 2)).toEqual({ min: 1, max: 3 });
    expect(validRange(Number.NaN, 4)).toEqual({ min: -5, max: 4 });
    expect(validRange(-1e12, 1e12)).toEqual({ min: -1_000_000, max: 1_000_000 });
  });

  it("fits y to the values, ignoring spikes and pulling a nearby zero in", () => {
    const parabola = autoRange(Array.from({ length: 101 }, (_, index) => ((index - 50) / 10) ** 2));
    expect(parabola.min).toBeLessThan(0);
    expect(parabola.max).toBeGreaterThan(24);
    const spiky = autoRange([...Array.from({ length: 200 }, (_, index) => Math.sin(index / 10)), 1e9, -1e9]);
    expect(spiky.max).toBeLessThan(2);
    expect(autoRange([3, 3, 3])).toEqual({ min: 2, max: 4 });
    expect(autoRange([Number.NaN])).toEqual({ min: -5, max: 5 });
  });
});

describe("curvePieces", () => {
  const x = { min: -5, max: 5 };
  const y = { min: -5, max: 5 };

  it("draws a continuous function in one piece clipped to the window", () => {
    const pieces = curvePieces((value) => value * value, x, y, 200);
    expect(pieces).toHaveLength(1);
    for (const point of pieces[0]) {
      expect(point.y).toBeLessThanOrEqual(5 + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(-5 - 1e-9);
    }
  });

  it("breaks the curve at an asymptote instead of drawing a vertical line", () => {
    const pieces = curvePieces((value) => 1 / value, x, y, 200);
    expect(pieces).toHaveLength(2);
    expect(Math.max(...pieces[0].map((point) => point.x))).toBeLessThan(0);
    expect(Math.min(...pieces[1].map((point) => point.x))).toBeGreaterThan(0);
  });

  it("leaves out where the function is not defined", () => {
    const pieces = curvePieces(Math.sqrt, x, y, 200);
    expect(pieces).toHaveLength(1);
    expect(Math.min(...pieces[0].map((point) => point.x))).toBeGreaterThanOrEqual(0);
    expect(curvePieces(() => Number.NaN, x, y, 50)).toEqual([]);
  });

  it("splits tan into one piece per branch", () => {
    expect(curvePieces(Math.tan, { min: -4, max: 4 }, y, 800)).toHaveLength(3);
  });
});

describe("planGraph", () => {
  it("plots every valid function in its colour with a legend and finite coordinates", () => {
    const plan = planGraph({ ...DEFAULT_GRAPH, functions: [{ expression: "x^2", color: "#ff0000" }, { expression: "sin x", color: "#00ff00" }] });
    expect(plan.primitives.every(isFinitePrimitive)).toBe(true);
    const curves = plan.primitives.filter((item) => item.type === "polyline" && item.color === "#ff0000" && item.points.length > 10);
    expect(curves.length).toBeGreaterThan(0);
    const legend = plan.primitives.filter((item) => item.type === "label" && item.latex.includes("(x) = "));
    expect(legend.map((item) => (item.type === "label" ? item.latex : ""))).toEqual(["f(x) = x^{2}", "g(x) = \\sin x"]);
  });

  it("keeps curves inside the plot area", () => {
    const plan = planGraph({ ...DEFAULT_GRAPH, legend: false, functions: [{ expression: "tan x", color: "#000000" }] });
    for (const item of plan.primitives) {
      if (item.type !== "polyline" || item.color !== "#000000") continue;
      for (const point of item.points) {
        expect(point.x).toBeGreaterThanOrEqual(-1e-6);
        expect(point.x).toBeLessThanOrEqual(PLOT_WIDTH + 1e-6);
        expect(point.y).toBeGreaterThanOrEqual(-1e-6);
        expect(point.y).toBeLessThanOrEqual(PLOT_HEIGHT + 1e-6);
      }
    }
  });

  it("skips empty and broken rows but reports them", () => {
    const plan = planGraph({ ...DEFAULT_GRAPH, functions: [{ expression: "", color: "#000000" }, { expression: "x +", color: "#111111" }, { expression: "x", color: "#222222" }] });
    expect(plan.parsed.map((result) => ("expression" in result ? "ok" : result.error))).toEqual(["empty", "unexpected", "ok"]);
    const legend = plan.primitives.filter((item) => item.type === "label" && item.latex.includes("(x) = "));
    expect(legend).toHaveLength(1);
    expect(legend[0].type === "label" && legend[0].latex).toBe("h(x) = x");
  });

  it("uses the typed y range when automatic is off, and one scale for both axes when asked", () => {
    expect(planGraph({ ...DEFAULT_GRAPH, autoY: false, yMin: -2, yMax: 3 }).y).toEqual({ min: -2, max: 3 });
    const equal = planGraph({ ...DEFAULT_GRAPH, xMin: -4, xMax: 4, equalScale: true });
    expect((equal.y.max - equal.y.min) / (equal.x.max - equal.x.min)).toBeCloseTo(PLOT_HEIGHT / PLOT_WIDTH);
  });

  it("leaves out the grid and legend when they are off", () => {
    const plan = planGraph({ ...DEFAULT_GRAPH, grid: false, legend: false });
    expect(plan.primitives.some((item) => item.type === "polyline" && item.color === "#d4d4d8")).toBe(false);
    expect(plan.primitives.some((item) => item.type === "label" && item.latex.includes("(x) = "))).toBe(false);
  });
});
