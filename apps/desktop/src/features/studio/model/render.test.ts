import { describe, expect, it } from "vitest";
import { STUDIO_SHAPES } from "@/types/studio";
import { createDesign, createImage, createQr, createShape, createText } from "./design";
import { designToRender, elementItems, imagePaths } from "./render";
import { linearGradientLine, renderFill, renderStroke, shapeD, shapePaths } from "./shapes";

const PATH_GRAMMAR = /^(?:[MLCZ](?: ?-?\d+(?:\.\d+)?)*\s*)+$/;

describe("studio shapes", () => {
  it.each(STUDIO_SHAPES)("draws %s inside its box with plain path commands", (shape) => {
    const d = shapeD(shape, 120, 80, { cornerRadius: 10, points: 5, innerRatio: 0.4 });

    expect(d).toMatch(PATH_GRAMMAR);
    const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(120);
  });

  it("follows CSS gradient angles", () => {
    const across = linearGradientLine(90, 200, 100);
    expect([across.x1, across.y1, across.x2, across.y2].map((value) => Math.round(value))).toEqual([0, 50, 200, 50]);
    const diagonal = linearGradientLine(180, 200, 100);
    expect(diagonal.x1).toBeCloseTo(100);
    expect(diagonal.y1).toBeCloseTo(0);
    expect(diagonal.y2).toBeCloseTo(100);
    expect(renderFill({ type: "radial", stops: [] }, 30, 40)).toMatchObject({ cx: 15, cy: 20, r: 25 });
    expect(renderFill({ type: "none" }, 1, 1)).toBeNull();
  });

  it("turns dash styles into dash arrays", () => {
    expect(renderStroke({ color: "#000000", width: 2, dash: "dashed" })?.dash).toEqual([6, 4]);
    expect(renderStroke({ color: "#000000", width: 2, dash: "dotted" })).toMatchObject({ dash: [0, 4], cap: "round" });
    expect(renderStroke({ color: "#000000", width: 0, dash: "solid" })).toBeNull();
  });

  it("gives arrow lines a filled head and skips invisible shapes", () => {
    const arrow = createShape("arrowLine", 0, 0, 100, 20);
    const ghost = createShape("rect", 0, 0, 10, 10, { fill: { type: "none" }, stroke: null });

    expect(shapePaths(arrow)).toHaveLength(2);
    expect(shapePaths(arrow)[1].fill).toEqual({ type: "solid", color: "#1f2937" });
    expect(shapePaths(ghost)).toEqual([]);
  });
});

describe("studio render payload", () => {
  it("keeps stacking order and skips hidden or empty elements", () => {
    const design = createDesign("Poster", 300, 300);
    design.pages[0].background.fill = { type: "linear", angle: 90, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] };
    const hidden = { ...createShape("rect", 0, 0, 5, 5), hidden: true };
    design.pages[0].elements.push(createShape("ellipse", 10, 10, 50, 50), hidden, createText(0, 0, 10, 10, "  "), createQr("x", 0, 0, 20));

    const [page] = designToRender(design);

    expect(page.items.map((item) => item.kind)).toEqual(["vector", "vector", "qr"]);
  });

  it("leaves a plain white background out", () => {
    const [page] = designToRender(createDesign("Blank", 100, 100));

    expect(page.items).toEqual([]);
  });

  it("fills text styling from the element and uses measured segments only without placeholders", () => {
    const text = createText(0, 0, 100, 40, "", { bold: true, color: "#112233", letterSpacing: 0.1, fontSize: 20 });
    text.runs = [{ text: "Hello " }, { text: "world", bold: false, color: "#ff0000" }];
    const measured = new Map([[text.id, [{ text: "Hello", x: 0, y: 10, size: 20, bold: true, italic: false, underline: false, color: "#112233", letterSpacing: 2 }]]]);

    const [item] = elementItems(text, measured);
    const [merged] = elementItems({ ...text, runs: [{ text: "Hi {Name}" }] }, measured);

    expect(item.kind === "text" && item.runs[1]).toEqual({ text: "world", bold: false, italic: false, underline: false, color: "#ff0000" });
    expect(item.kind === "text" && item.letterSpacing).toBe(2);
    expect(item.kind === "text" && item.segments).toHaveLength(1);
    expect(merged.kind === "text" && merged.segments).toBeUndefined();
  });

  it("adds a frame stroke that follows the image mask", () => {
    const image = { ...createImage("C:/photo.png", 0, 0, 80, 80), mask: "circle" as const, stroke: { color: "#ffffff", width: 4, dash: "solid" as const } };

    const items = elementItems(image);

    expect(items.map((item) => item.kind)).toEqual(["image", "vector"]);
    expect(items[0].kind === "image" && items[0].crop).toBeNull();
    expect(items[1].kind === "vector" && items[1].paths[0].d).toContain("C");
  });

  it("collects every picture the design needs", () => {
    const design = createDesign("Photos", 100, 100);
    design.pages[0].background.image = { src: "C:/bg.jpg", fit: "cover", opacity: 1 };
    design.pages[0].elements.push(createImage("C:/a.png", 0, 0, 10, 10), createImage("C:/a.png", 5, 5, 10, 10));

    expect(imagePaths(design)).toEqual(["C:/bg.jpg", "C:/a.png"]);
  });
});
