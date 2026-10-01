import { describe, expect, it } from "vitest";
import type { Primitive } from "./primitives";
import { DEFAULT_SHAPE_STYLE, labelsOf, renderShape, shapeDataUrl, type LabelArt } from "./render";
import { box, polyhedron } from "./solids";

const square: Primitive = { type: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], closed: true, fill: 1 };
const label: Primitive = { type: "label", latex: "a", at: { x: 50, y: 120 }, anchor: "n" };
const art: LabelArt = { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -500 1000 1000"><path fill="currentColor" d="M0 0L10 10"/></svg>', emWidth: 1, emHeight: 1 };

function pathCount(svg: string): number {
  return (svg.match(/<path /g) ?? []).length;
}

describe("renderShape", () => {
  it("draws the outline in the chosen colour and sizes the drawing to its content", () => {
    const rendered = renderShape([square], { ...DEFAULT_SHAPE_STYLE, stroke: "#aa0000" }, new Map());
    expect(rendered.svg).toContain('stroke="#aa0000"');
    expect(rendered.svg).not.toContain("fill-opacity");
    expect(rendered.width).toBeGreaterThan(100);
    expect(rendered.width).toBeLessThan(110);
    expect(rendered.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[-\d. ]+" width="[\d.]+" height="[\d.]+">/);
  });

  it("fills closed shapes only when a fill colour is set", () => {
    const rendered = renderShape([square], { ...DEFAULT_SHAPE_STYLE, fill: "#2563eb" }, new Map());
    expect(rendered.svg).toContain('fill="#2563eb" fill-opacity="0.3"');
  });

  it("falls back to safe colours when a colour is not a plain hex value", () => {
    const rendered = renderShape([square], { ...DEFAULT_SHAPE_STYLE, stroke: 'red" onload="x', fill: "url(#x)" }, new Map());
    expect(rendered.svg).not.toContain("onload");
    expect(rendered.svg).not.toContain("url(");
    expect(rendered.svg).toContain('stroke="#111111"');
  });

  it("places typeset labels in the stroke colour and leaves them out when labels are off", () => {
    const labels = new Map([["a", art]]);
    const withLabels = renderShape([square, label], { ...DEFAULT_SHAPE_STYLE, stroke: "#003366" }, labels);
    expect(withLabels.svg).toContain('<g transform="translate(');
    expect(withLabels.svg).toContain('fill="#003366"');
    expect(withLabels.svg).not.toContain("currentColor");
    expect(withLabels.height).toBeGreaterThan(130);
    const without = renderShape([square, label], { ...DEFAULT_SHAPE_STYLE, labels: false }, labels);
    expect(without.svg).not.toContain("<g ");
    expect(without.height).toBeLessThan(110);
  });

  it("skips a label that has not been typeset yet", () => {
    const rendered = renderShape([square, label], DEFAULT_SHAPE_STYLE, new Map());
    expect(rendered.svg).not.toContain("<g ");
  });

  it("dashes lines by splitting them into pieces", () => {
    const dashed = renderShape([{ type: "polyline", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], line: "dashed" }], DEFAULT_SHAPE_STYLE, new Map());
    expect(dashed.svg).not.toContain("stroke-dasharray");
    expect((dashed.svg.match(/M/g) ?? []).length).toBeGreaterThan(5);
  });

  it("draws arrows with filled heads, on both ends when asked", () => {
    const one = renderShape([{ type: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }], DEFAULT_SHAPE_STYLE, new Map());
    const both = renderShape([{ type: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, both: true }], DEFAULT_SHAPE_STYLE, new Map());
    expect(pathCount(one.svg)).toBe(2);
    expect(pathCount(both.svg)).toBe(3);
  });

  it("drops primitives with broken coordinates and returns a tiny empty drawing when nothing is left", () => {
    const rendered = renderShape([{ type: "circle", center: { x: Number.NaN, y: 0 }, radius: 10 }], DEFAULT_SHAPE_STYLE, new Map());
    expect(rendered.width).toBe(1);
    expect(rendered.svg).not.toContain("NaN");
  });

  it("lists each label once and encodes the drawing as a data URL", () => {
    expect(labelsOf([label, label, square, { ...label, latex: "b" }])).toEqual(["a", "b"]);
    expect(shapeDataUrl('<svg a="#"/>')).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%23%22%2F%3E");
  });
});

describe("polyhedron", () => {
  const cube = box(100, 100, 100);

  it("shows only the front face of a cube seen straight on, with the back edges dashed", () => {
    const primitives = polyhedron(cube, { yaw: 0, pitch: 0, hidden: true });
    const faces = primitives.filter((item) => item.type === "polyline" && item.line === "none");
    const dashed = primitives.filter((item) => item.type === "polyline" && item.line === "dashed");
    const solid = primitives.filter((item) => item.type === "polyline" && item.line === undefined);
    expect(faces).toHaveLength(1);
    expect(solid).toHaveLength(4);
    expect(dashed).toHaveLength(8);
  });

  it("shows three faces from a corner view and hides the back edges when asked", () => {
    const shown = polyhedron(cube, { yaw: 32, pitch: 20, hidden: true });
    const hidden = polyhedron(cube, { yaw: 32, pitch: 20, hidden: false });
    expect(shown.filter((item) => item.type === "polyline" && item.line === "none")).toHaveLength(3);
    expect(shown.filter((item) => item.type === "polyline" && item.line === "dashed")).toHaveLength(3);
    expect(hidden.filter((item) => item.type === "polyline" && item.line === "dashed")).toHaveLength(0);
    expect(hidden.filter((item) => item.type === "polyline" && item.line === undefined)).toHaveLength(9);
  });

  it("labels an edge that is actually drawn", () => {
    const primitives = polyhedron(cube, { yaw: 32, pitch: 20, hidden: true }, [{ axis: "x", latex: "a" }]);
    expect(primitives.filter((item) => item.type === "label")).toHaveLength(1);
  });
});
