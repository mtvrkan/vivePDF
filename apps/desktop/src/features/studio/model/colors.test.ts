import { describe, expect, it } from "vitest";
import { designColors, recolorDesign, recolorElement, uniqueElementColors } from "./colors";
import { createDesign, createShape, createText } from "./design";

function sample() {
  const design = createDesign("Colours", 200, 100);
  const title = createText(0, 0, 100, 20, "Hi", { color: "#1F4E8C", runs: [{ text: "Hi", color: "#C9A227" }] });
  const band = createShape("rect", 0, 0, 200, 20, { fill: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#1f4e8c" }, { offset: 1, color: "#ffffff" }] }, stroke: { color: "#c9a227", width: 1, dash: "solid" } });
  const page = { ...design.pages[0], background: { fill: { type: "solid" as const, color: "#FFFFFF" }, image: null }, elements: [title, band, createShape("ellipse", 0, 0, 10, 10, { fill: { type: "solid", color: "#1f4e8c" } })] };
  return { ...design, pages: [page] };
}

describe("studio design colours", () => {
  it("lists every colour once, the most used first, ignoring letter case", () => {
    expect(designColors(sample())).toEqual(["#1f4e8c", "#ffffff", "#c9a227"]);
  });

  it("swaps one colour everywhere: text, runs, gradients, strokes and the page", () => {
    const changed = recolorDesign(sample(), "#1f4e8c", "#8c1f3a");

    expect(designColors(changed)).toEqual(["#8c1f3a", "#ffffff", "#c9a227"]);
    const [title, band] = changed.pages[0].elements;
    expect(title.kind === "text" && title.color).toBe("#8c1f3a");
    expect(band.kind === "shape" && band.fill.type === "linear" && band.fill.stops[0].color).toBe("#8c1f3a");
  });

  it("leaves elements without the colour untouched and reports colours of one element", () => {
    const band = sample().pages[0].elements[1];

    expect(recolorElement(band, "#000000", "#ff0000")).toEqual(band);
    expect(uniqueElementColors(band)).toEqual(["#1f4e8c", "#ffffff", "#c9a227"]);
  });
});
