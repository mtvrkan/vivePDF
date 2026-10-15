import { afterEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { Stroke } from "@/shared/store/presentationStore";
import { formatLength, measureLabel, measureLayout, visiblePageSize } from "./measure";

const POINTS_PER_CM = 72 / 2.54;

function measure(points: Array<[number, number]>, pageSize?: { width: number; height: number }): Stroke {
  return { id: "m", tool: "measure", color: "#E5484D", width: 0.004, points: points.map(([x, y]) => ({ x, y })), ...(pageSize ? { pageSize } : {}) };
}

afterEach(() => useDocumentStore.setState({ documents: {}, order: [], activeId: null }));

describe("formatLength", () => {
  it("shows centimetres with one decimal and short lengths in millimetres", () => {
    expect(formatLength(POINTS_PER_CM * 12.34, "en")).toBe("12.3 cm");
    expect(formatLength(POINTS_PER_CM * 0.8, "en")).toBe("8 mm");
  });

  it("follows the language's number format", () => {
    expect(formatLength(POINTS_PER_CM * 2.5, "tr")).toBe("2,5 cm");
  });
});

describe("measureLabel", () => {
  it("measures the real length on the page, both axes included", () => {
    const page = { width: POINTS_PER_CM * 20, height: POINTS_PER_CM * 10 };

    expect(measureLabel(measure([[0, 0], [0.15, 0.4]], page), "en")).toBe("5 cm");
  });

  it("has no label without the page size", () => {
    expect(measureLabel(measure([[0, 0], [0.5, 0]]), "en")).toBeNull();
  });
});

describe("measureLayout", () => {
  it("puts square ticks on both ends and the label above a level line", () => {
    const layout = measureLayout(measure([[0.1, 0.5], [0.6, 0.5]], { width: 600, height: 300 }), 1000, 500, "en");

    expect(layout?.ticks).toHaveLength(2);
    const [[top, bottom]] = layout!.ticks;
    expect(top.x).toBeCloseTo(100);
    expect(bottom.x).toBeCloseTo(100);
    expect(top.y).toBeLessThan(250);
    expect(bottom.y).toBeGreaterThan(250);
    expect(layout?.labelCenter.x).toBeCloseTo(350);
    expect(layout?.labelCenter.y).toBeLessThan(top.y);
    expect(layout?.labelAngle).toBeCloseTo(0);
  });

  it("keeps the label upright when the line is drawn right to left", () => {
    const layout = measureLayout(measure([[0.6, 0.5], [0.1, 0.5]], { width: 600, height: 300 }), 1000, 500, "en");

    expect(Math.abs(layout!.labelAngle) % (2 * Math.PI)).toBeCloseTo(0);
    expect(layout?.labelCenter.y).toBeLessThan(250);
  });
});

describe("visiblePageSize", () => {
  it("swaps the page size when the shown page is turned", () => {
    useDocumentStore.setState({ activeId: "d", documents: { d: { info: { pageSizes: [{ width: 600, height: 800 }] } } } as never });

    expect(visiblePageSize(0, { width: 300, height: 400 })).toEqual({ width: 600, height: 800 });
    expect(visiblePageSize(0, { width: 400, height: 300 })).toEqual({ width: 800, height: 600 });
    expect(visiblePageSize(3, { width: 400, height: 300 })).toBeUndefined();
  });
});
