import { describe, expect, it } from "vitest";
import { STUDIO_ARROWHEADS, type StudioRenderStroke } from "@/types/studio";
import { createShape } from "./design";
import { arrowhead, arrowheadLength, clampedCorners, cornerRect, roundedRect, shapeD, shapePaths } from "./shapes";

const STROKE: StudioRenderStroke = { color: "#112233", width: 2, dash: [], cap: "butt", join: "miter" };

function numbers(d: string): number[] {
  return [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

describe("per-corner rectangles", () => {
  it("rounds only the corners that have a radius", () => {
    const d = cornerRect(0, 0, 100, 60, [20, 0, 10, 0]);

    expect(d.startsWith("M20 0 L100 0 L100 50 C")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
    expect(d).toContain("L0 60 L0 20 C");
  });

  it("clamps radii that exceed half of the shorter side", () => {
    expect(clampedCorners(100, 40, [80, 10, -5, Number.NaN])).toEqual([20, 10, 0, 0]);
    expect(cornerRect(0, 0, 100, 40, [80, 80, 80, 80])).toBe(roundedRect(0, 0, 100, 40, 20));
  });

  it("keeps the equal-radius path and the square path identical to the linked form", () => {
    expect(roundedRect(0, 0, 50, 50, 10)).toBe("M10 0 L40 0 C45.523 0 50 4.477 50 10 L50 40 C50 45.523 45.523 50 40 50 L10 50 C4.477 50 0 45.523 0 40 L0 10 C0 4.477 4.477 0 10 0 Z");
    expect(cornerRect(0, 0, 50, 50, [0, 0, 0, 0])).toBe("M0 0 L50 0 L50 50 L0 50 Z");
  });

  it("uses the separate corners of a rectangle shape when they are set", () => {
    const linked = shapeD("rect", 80, 80, { cornerRadius: 12, corners: null });
    const separate = shapeD("rect", 80, 80, { cornerRadius: 12, corners: [0, 30, 0, 30] });

    expect(linked).toBe(roundedRect(0, 0, 80, 80, 12));
    expect(separate).toBe(cornerRect(0, 0, 80, 80, [0, 30, 0, 30]));
  });
});

describe("cloud shape", () => {
  it("touches every side of its box and keeps all points inside it", () => {
    const values = numbers(shapeD("cloud", 240, 150));
    const xs = values.filter((_, index) => index % 2 === 0);
    const ys = values.filter((_, index) => index % 2 === 1);

    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(240);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(150);
  });
});

describe("arrowheads", () => {
  it.each(STUDIO_ARROWHEADS.filter((kind) => kind !== "none"))("draws a %s head in the stroke colour at the line end", (kind) => {
    const head = arrowhead(kind, 100, 10, 1, 14, STROKE);

    expect(head.paths.length).toBe(1);
    const path = head.paths[0];
    expect(path.fill?.type === "solid" ? path.fill.color : path.stroke?.color).toBe("#112233");
    expect(Math.max(...numbers(path.d).filter((_, index) => index % 2 === 0))).toBeLessThanOrEqual(kind === "openArrow" ? 100 : 105.6);
  });

  it("gives an open arrow a solid miter stroke even when the line is dashed", () => {
    const head = arrowhead("openArrow", 0, 10, -1, 14, { ...STROKE, dash: [6, 4], join: "round" });

    expect(head.paths[0].stroke).toMatchObject({ dash: [], join: "miter", width: 2 });
    expect(head.inset).toBeCloseTo(Math.sqrt(5));
  });

  it("draws nothing for no head and scales heads with the stroke width", () => {
    expect(arrowhead("none", 0, 0, 1, 10, STROKE)).toEqual({ paths: [], inset: 0 });
    expect(arrowheadLength(1, 1, 500)).toBe(6);
    expect(arrowheadLength(4, 2, 500)).toBe(28);
    expect(arrowheadLength(4, 2, 10)).toBe(10);
  });
});

describe("line paths", () => {
  it("keeps an old arrow line identical to its previous drawing", () => {
    const element = createShape("arrowLine", 0, 0, 200, 16);

    const [shaft, head] = shapePaths(element);

    expect(shaft.d).toBe("M0 8 L194.4 8");
    expect(head.d).toBe("M200 8 L193 4.5 L193 11.5 Z");
    expect(head.fill).toEqual({ type: "solid", color: "#1f2937" });
  });

  it("draws a plain line as one stroke and pulls the shaft back behind both heads", () => {
    const plain = createShape("line", 0, 0, 200, 16);
    const both = { ...plain, startArrow: "triangle" as const, endArrow: "arrow" as const };

    expect(shapePaths(plain)).toHaveLength(1);
    expect(shapePaths(plain)[0].d).toBe("M0 8 L200 8");
    const paths = shapePaths(both);
    expect(paths).toHaveLength(3);
    expect(paths[0].d).toBe("M5.6 8 L195.8 8");
  });

  it("draws nothing for a line without an outline", () => {
    expect(shapePaths({ ...createShape("line", 0, 0, 100, 10), stroke: null, endArrow: "arrow" })).toEqual([]);
  });
});
