import { describe, expect, it } from "vitest";
import { fractionBar, fractionCircle, probabilityTree, venn2, venn3 } from "./diagrams";
import type { Primitive } from "./primitives";
import { DEFAULT_SHAPE_STYLE, SOLID_TINT, labelsOf, renderShape } from "./render";

function shadedParts(primitives: Primitive[]): number {
  return primitives.filter((item) => item.type === "polyline" && item.solid && item.fill !== null && item.fill !== undefined).length;
}

describe("fractions", () => {
  it("cuts the whole into equal parts and shades the numerator's share", () => {
    const circle = fractionCircle(3, 8, true);
    expect(circle.filter((item) => item.type === "polyline")).toHaveLength(8);
    expect(shadedParts(circle)).toBe(3);
    expect(labelsOf(circle)).toEqual([String.raw`\frac{3}{8}`]);
    expect(shadedParts(fractionBar(2, 5, false))).toBe(2);
    expect(labelsOf(fractionBar(2, 5, false))).toEqual([]);
  });

  it("never shades more than the whole and rounds odd slider values", () => {
    expect(shadedParts(fractionBar(9, 4, true))).toBe(4);
    expect(labelsOf(fractionBar(9, 4, true))).toEqual([String.raw`\frac{4}{4}`]);
    expect(shadedParts(fractionCircle(2.6, 1, true))).toBe(2);
    expect(fractionCircle(0, 30, false).filter((item) => item.type === "polyline")).toHaveLength(16);
  });
});

describe("Venn diagrams", () => {
  it("draws two or three tinted sets with their names and an optional universal set", () => {
    expect(venn2(true).filter((item) => item.type === "circle")).toHaveLength(2);
    expect(labelsOf(venn2(true))).toEqual(["U", "A", "B"]);
    expect(labelsOf(venn2(false))).toEqual(["A", "B"]);
    expect(venn3(false).filter((item) => item.type === "circle" && item.solid)).toHaveLength(3);
    expect(labelsOf(venn3(true))).toEqual(["U", "A", "B", "C"]);
  });
});

describe("probability tree", () => {
  it("branches every stage and names outcomes and chances", () => {
    const tree = probabilityTree(2, 2);
    expect(tree.filter((item) => item.type === "polyline")).toHaveLength(2 + 4);
    expect(labelsOf(tree)).toEqual(expect.arrayContaining(["p", "1-p", "q", "1-q", "A", String.raw`\bar{A}`, "B", String.raw`\bar{B}`]));
    expect(tree.filter((item) => item.type === "dot")).toHaveLength(1);
  });

  it("uses numbered outcomes for three branches and stays within three stages", () => {
    const tree = probabilityTree(9, 3);
    expect(tree.filter((item) => item.type === "polyline")).toHaveLength(3 + 9 + 27);
    expect(labelsOf(tree)).toEqual(expect.arrayContaining(["p_1", "p_3", "A_2", "C_3", "r_2"]));
  });
});

describe("solid tint", () => {
  it("fills solid parts even without a chosen fill colour, and uses the chosen one when set", () => {
    const plain = renderShape(fractionBar(1, 2, false), DEFAULT_SHAPE_STYLE, new Map()).svg;
    expect(plain).toContain(`fill="${SOLID_TINT}"`);
    const coloured = renderShape(fractionBar(1, 2, false), { ...DEFAULT_SHAPE_STYLE, fill: "#ff0000" }, new Map()).svg;
    expect(coloured).toContain('fill="#ff0000"');
    expect(coloured).not.toContain(SOLID_TINT);
  });
});
