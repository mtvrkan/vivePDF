import { describe, expect, it } from "vitest";
import { STUDIO_SHAPES } from "@/types/studio";
import { createDesign, createImage, createQr, createShape, createText } from "./design";
import { designToRender, elementItems, hasSeeThroughBackground, imagePaths, pageToRender, renderItems } from "./render";
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

  it("draws every dash pattern with the chosen caps, joins and spacing", () => {
    expect(renderStroke({ color: "#000000", width: 2, dash: "longDash" })).toMatchObject({ dash: [14, 6], cap: "butt", join: "miter" });
    expect(renderStroke({ color: "#000000", width: 2, dash: "dashDot" })?.dash).toEqual([8, 4, 2, 4]);
    expect(renderStroke({ color: "#000000", width: 2, dash: "dashDot", cap: "round", join: "bevel" })).toMatchObject({ dash: [6, 6, 0, 6], cap: "round", join: "bevel" });
    expect(renderStroke({ color: "#000000", width: 2, dash: "dashed", gap: 2 })?.dash).toEqual([6, 8]);
    expect(renderStroke({ color: "#000000", width: 2, dash: "dotted", cap: "butt" })).toMatchObject({ dash: [2, 2], cap: "butt", join: "round" });
    expect(renderStroke({ color: "#000000", width: 2, dash: "solid", cap: "square", join: "round" })).toMatchObject({ dash: [], cap: "square", join: "round" });
  });

  it("keeps dash lengths and gradient radii inside what the exporter accepts", () => {
    expect(Math.max(...(renderStroke({ color: "#000000", width: 500, dash: "longDash", gap: 4 })?.dash ?? []))).toBe(2000);
    expect(renderFill({ type: "radial", stops: [], radius: 3 }, 20000, 20000)).toMatchObject({ r: 20000 });
  });

  it("moves the radial centre, scales its reach and sorts stops for both renderers", () => {
    const stops = [{ offset: 1, color: "#000000" }, { offset: 0, color: "#ffffff" }];
    const fill = renderFill({ type: "radial", stops, cx: 0, cy: 1, radius: 0.5 }, 30, 40);

    expect(fill).toMatchObject({ cx: 0, cy: 40, r: 12.5 });
    expect(fill && fill.type !== "solid" ? fill.stops.map((stop) => stop.offset) : []).toEqual([0, 1]);
    expect(stops[0].offset).toBe(1);
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

  it("paints a plain white background when see-through pictures need it", () => {
    const [page] = designToRender(createDesign("Blank", 100, 100), new Map(), { keepWhite: true });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ kind: "vector", paths: [{ fill: { type: "solid", color: "#ffffff" } }] });
  });

  it("treats only a page without fill or picture as see-through", () => {
    const design = createDesign("Blank", 100, 100);
    const page = design.pages[0];
    const none = { ...page, background: { fill: { type: "none" as const }, image: null } };

    const [rendered] = designToRender({ ...design, pages: [none] }, new Map(), { keepWhite: true });

    expect(rendered.items).toEqual([]);
    expect(hasSeeThroughBackground(none)).toBe(true);
    expect(hasSeeThroughBackground(page)).toBe(false);
    expect(hasSeeThroughBackground({ ...none, background: { ...none.background, image: { src: "a.png", fit: "cover", opacity: 1 } } })).toBe(false);
  });

  it("fills text styling from the element and uses measured segments only without placeholders", () => {
    const text = createText(0, 0, 100, 40, "", { bold: true, color: "#112233", letterSpacing: 0.1, fontSize: 20 });
    text.runs = [{ text: "Hello " }, { text: "world", bold: false, color: "#ff0000" }];
    const segment = { text: "Hello", x: 0, y: 10, size: 20, bold: true, italic: false, underline: false, strike: false, color: "#112233", letterSpacing: 2, fontId: null, weight: 700 };
    const measured = new Map([[text.id, { segments: [segment], bands: [] }]]);

    const [item] = elementItems(text, measured);
    const [merged] = elementItems({ ...text, runs: [{ text: "Hi {Name}" }] }, measured);

    expect(item.kind === "text" && item.runs[1]).toEqual({ text: "world", bold: false, italic: false, underline: false, strike: false, color: "#ff0000", fontId: null, size: 20, weight: 400 });
    expect(item.kind === "text" && item.letterSpacing).toBe(2);
    expect(item.kind === "text" && item.segments).toHaveLength(1);
    expect(merged.kind === "text" && merged.segments).toBeUndefined();
  });

  it("sends run fonts, scaled sizes, weights and text effects to the exporter", () => {
    const text = createText(0, 0, 100, 40, "", {
      fontId: "system:arial",
      fontSize: 10,
      weight: 300,
      textCase: "upper",
      paragraphs: [{ list: "bullet", level: 1 }],
      outline: { color: "#000000", width: 1 },
      highlight: { color: "#fde047", padding: 2 },
      runs: [{ text: "a", fontId: "system:georgia", scale: 2.5, weight: 800 }, { text: "b", scale: 500 }],
    });
    const measured = new Map([[text.id, { segments: [], bands: [{ x: 0, y: 0, width: 10, height: 5 }] }]]);

    const [item] = elementItems(text, measured);

    expect(item.kind === "text" && item.runs.map((run) => [run.fontId, run.size, run.weight])).toEqual([
      ["system:georgia", 25, 800],
      ["system:arial", 1000, 300],
    ]);
    expect(item).toMatchObject({ textCase: "upper", paragraphs: [{ list: "bullet", level: 1 }], outline: { width: 1 }, bands: [{ width: 10 }] });
    expect(elementItems({ ...text, highlight: null }, measured)[0]).not.toHaveProperty("bands");
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

describe("element drop shadows", () => {
  const shadow = { color: "#000000", opacity: 0.4, x: 3, y: 5, blur: 8 };

  it("puts a shadow item with the element's own items under them", () => {
    const image = { ...createImage("C:/a.png", 10, 20, 30, 40), opacity: 0.5, stroke: { color: "#ff0000", width: 2, dash: "solid" as const }, dropShadow: shadow };

    const items = pageToRender({ ...createDesign("x", 100, 100).pages[0], elements: [image] }).items;

    expect(items.map((item) => item.kind)).toEqual(["shadow", "image", "vector"]);
    expect(items[0]).toMatchObject({ kind: "shadow", x: 10, y: 20, width: 30, height: 40, opacity: 0.5, shadow });
    expect(items[0].kind === "shadow" && items[0].items.map((item) => [item.kind, item.opacity])).toEqual([["image", 1], ["vector", 1]]);
  });

  it("leaves elements without a visible shadow alone", () => {
    const shape = createShape("rect", 0, 0, 10, 10);

    expect(renderItems(shape)).toEqual(elementItems(shape));
    expect(renderItems({ ...shape, dropShadow: { ...shadow, opacity: 0 } })).toHaveLength(1);
  });

  it("casts no shadow from an element that draws nothing", () => {
    expect(renderItems({ ...createShape("rect", 0, 0, 10, 10), fill: { type: "none" }, dropShadow: shadow })).toEqual([]);
  });
});
