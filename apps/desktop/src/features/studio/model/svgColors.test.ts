import { describe, expect, it } from "vitest";
import type { StudioSvgElement } from "@/types/studio";
import { designColors, recolorDesign, recolorElement, uniqueElementColors } from "./colors";
import { createDesign, createSvg, normalizeElement } from "./design";
import { elementItems } from "./render";
import { effectiveSvgColors, recolorSvg, svgColors, swapSvgColors } from "./svgColors";

const DRAWING = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">',
  "<defs><linearGradient id=\"g\"><stop offset=\"0\" stop-color=\"#FFF\"/><stop offset=\"1\" style=\"stop-color: Navy\"/></linearGradient>",
  "<style>.a{fill:#C9A227;stroke:none} .b { stroke : rgb(255, 0, 0) }</style></defs>",
  '<rect class="a" width="10" height="10" fill="#1F4E8C" stroke="none" stroke-width="2"/>',
  '<circle cx="5" cy="5" r="4" fill="url(#g)" style="stroke:#1f4e8c;fill-opacity:0.5" data-fill="#123456"/>',
  "<text x=\"1\" y=\"9\">fill: red</text>",
  "</svg>",
].join("");

describe("colours inside an svg", () => {
  it("lists every distinct colour from attributes, style attributes, stylesheets and gradient stops", () => {
    expect(svgColors(DRAWING).sort()).toEqual(["#000080", "#1f4e8c", "#c9a227", "#ff0000", "#ffffff"].sort());
  });

  it("ignores none, gradients, other attributes and text content", () => {
    const colors = svgColors(DRAWING);
    expect(colors).not.toContain("#123456");
    expect(colors).toHaveLength(5);
    expect(svgColors('<svg><path fill="none" stroke="transparent"/></svg>')).toEqual([]);
  });

  it("replaces one colour everywhere it is used, in every notation", () => {
    const changed = recolorSvg(DRAWING, { "#1f4e8c": "#8c1f3a", "#ffffff": "#000000", "#000080": "#00ff00", "#ff0000": "#0000ff" });
    expect(changed).toContain('fill="#8c1f3a"');
    expect(changed).toContain("stroke:#8c1f3a");
    expect(changed).toContain('stop-color="#000000"');
    expect(changed).toContain("stop-color: #00ff00");
    expect(changed).toContain("stroke : #0000ff");
    expect(changed).toContain('data-fill="#123456"');
    expect(changed).toContain(">fill: red</text>");
    expect(svgColors(changed).sort()).toEqual(["#000000", "#00ff00", "#0000ff", "#8c1f3a", "#c9a227"].sort());
  });

  it("keeps transparency when the original colour had some", () => {
    const svg = '<svg><rect fill="#f008" stroke="rgba(0, 0, 255, 0.5)"/><path fill="#00ff0080"/></svg>';
    expect(svgColors(svg).sort()).toEqual(["#0000ff", "#00ff00", "#ff0000"]);
    const changed = recolorSvg(svg, { "#ff0000": "#112233", "#0000ff": "#445566", "#00ff00": "#778899" });
    expect(changed).toContain('fill="#11223388"');
    expect(changed).toContain('stroke="rgba(68, 85, 102, 0.5)"');
    expect(changed).toContain('fill="#77889980"');
  });

  it("treats currentColor as the drawing's colour and writes it out explicitly so the PDF matches", () => {
    const svg = '<svg viewBox="0 0 2 2"><path d="M0 0h2" stroke="currentColor"/></svg>';
    expect(svgColors(svg)).toEqual(["#000000"]);
    expect(recolorSvg(svg, { "#000000": "#ff6600" })).toBe('<svg viewBox="0 0 2 2"><path d="M0 0h2" stroke="#ff6600"/></svg>');
    expect(recolorSvg(svg, { "#123456": "#ff6600" })).toBe('<svg viewBox="0 0 2 2"><path d="M0 0h2" stroke="#000000"/></svg>');
    expect(recolorSvg(svg, {})).toBe(svg);
    const coloured = '<svg color="red"><path stroke="currentColor" style="fill: currentColor"/></svg>';
    expect(svgColors(coloured)).toEqual(["#ff0000"]);
    expect(recolorSvg(coloured, undefined)).toBe('<svg color="red"><path stroke="#ff0000" style="fill: #ff0000"/></svg>');
    expect(recolorSvg(coloured, { "#ff0000": "#00ff00" })).toBe('<svg color="#00ff00"><path stroke="#00ff00" style="fill: #00ff00"/></svg>');
  });

  it("returns the same markup when nothing is mapped and rejects nothing on malformed colours", () => {
    expect(recolorSvg(DRAWING, undefined)).toBe(DRAWING);
    expect(recolorSvg(DRAWING, {})).toBe(DRAWING);
    expect(svgColors('<svg><rect fill="#12345"/><rect fill="rgb(1,2)"/></svg>')).toEqual([]);
  });

  it("swaps effective colours into a colour map and drops entries that return to the original", () => {
    const map = swapSvgColors(DRAWING, undefined, (color) => (color === "#c9a227" ? "#FF00FF" : color));
    expect(map).toEqual({ "#c9a227": "#ff00ff" });
    expect(effectiveSvgColors(DRAWING, map)).toContain("#ff00ff");
    expect(swapSvgColors(DRAWING, map, (color) => (color === "#ff00ff" ? "#c9a227" : color))).toBeUndefined();
    expect(swapSvgColors(DRAWING, map, (color) => color)).toBe(map);
  });
});

describe("recoloured markup handed to the sidecar", () => {
  it("produces exactly the drawing the sidecar export test renders", () => {
    const original =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"><style>.a{fill:#C9A227}</style><rect class="a" width="50" height="50"/><rect x="50" width="50" height="50" style="fill:red"/><path d="M0 55h100" stroke="currentColor" stroke-width="10"/></svg>';

    const changed = recolorSvg(original, { "#c9a227": "#00ff00", "#ff0000": "#0000ff", "#000000": "#ff6600" });

    expect(changed).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"><style>.a{fill:#00ff00}</style><rect class="a" width="50" height="50"/><rect x="50" width="50" height="50" style="fill:#0000ff"/><path d="M0 55h100" stroke="#ff6600" stroke-width="10"/></svg>',
    );
  });
});

describe("svg elements with a colour map", () => {
  const element = (): StudioSvgElement => createSvg(DRAWING, 0, 0, 20, 20);

  it("keeps a valid colour map through normalisation and drops bad entries", () => {
    const normalized = normalizeElement({ ...element(), colorMap: { "#1F4E8C": "#8C1F3A", "#ffffff": "red", nope: "#000000", "#c9a227": "#c9a227" } });
    expect(normalized?.kind === "svg" && normalized.colorMap).toEqual({ "#1f4e8c": "#8c1f3a" });
    const empty = normalizeElement({ ...element(), colorMap: { bad: 1 } });
    expect(empty && "colorMap" in empty).toBe(false);
  });

  it("exports the recoloured markup so the PDF matches the canvas", () => {
    const [item] = elementItems({ ...element(), colorMap: { "#1f4e8c": "#8c1f3a" } });
    expect(item.kind === "svg" && item.svg).toContain('fill="#8c1f3a"');
    expect(item.kind === "svg" && item.svg).not.toContain("#1F4E8C");
  });

  it("recolours an svg like any other element and in design-wide swaps", () => {
    const svg = element();
    const changed = recolorElement(svg, "#c9a227", "#00aa00");
    expect(changed.kind === "svg" && changed.colorMap).toEqual({ "#c9a227": "#00aa00" });
    expect(uniqueElementColors(changed)).toContain("#00aa00");
    expect(recolorElement(svg, "#abcdef", "#000000")).toBe(svg);
    const reverted = recolorElement(changed, "#00aa00", "#c9a227");
    expect(reverted.kind === "svg" && "colorMap" in reverted).toBe(false);

    const design = createDesign("Svg", 100, 100);
    const withSvg = { ...design, pages: [{ ...design.pages[0], elements: [svg] }] };
    expect(designColors(withSvg)).toContain("#1f4e8c");
    const swapped = recolorDesign(withSvg, "#1f4e8c", "#222222");
    const [first] = swapped.pages[0].elements;
    expect(first.kind === "svg" && first.colorMap).toEqual({ "#1f4e8c": "#222222" });
  });
});
