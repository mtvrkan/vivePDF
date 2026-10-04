import icons from "virtual:studio-icons";
import { describe, expect, it } from "vitest";
import { createVector, normalizeElement } from "../model/design";
import { elementItems } from "../model/render";
import { vectorStrokeWidth, withVectorStrokeWidth } from "../model/vectorStroke";
import { ICON_VIEW, iconArt, type IconNode } from "./iconArt";

const ALARM: IconNode = [
  ["circle", { cx: "12", cy: "13", r: "8" }],
  ["path", { d: "M12 9v4l2 2" }],
  ["path", { d: "M5 3 2 6" }],
  ["rect", { x: "2", y: "2", width: "4", height: "4", rx: "1" }],
  ["circle", { cx: "12", cy: "13", r: "1", fill: "currentColor" }],
];

describe("icon drawings as vector art", () => {
  it("merges the outline parts into one stroked path and keeps filled parts apart", () => {
    const art = iconArt(ALARM, "#1f4e8c");
    expect(art.viewWidth).toBe(ICON_VIEW);
    expect(art.paths).toHaveLength(2);
    const [outline, dot] = art.paths;
    expect(outline.fill).toEqual({ type: "none" });
    expect(outline.stroke).toEqual({ color: "#1f4e8c", width: 2, dash: "solid", cap: "round", join: "round" });
    expect(outline.d.match(/M/g)).toHaveLength(4);
    expect(dot.fill).toEqual({ type: "solid", color: "#1f4e8c" });
  });

  it("skips unknown or empty parts and survives normalisation", () => {
    const art = iconArt([["g", {}], ["path", { d: "M0 0L4 4" }]], "#000000", 1.5);
    expect(art.paths).toHaveLength(1);
    expect(art.paths[0].stroke?.width).toBe(1.5);
    const element = normalizeElement(createVector(art, 10, 10, 48, 48, "Line"));
    expect(element?.kind === "vector" && element.paths[0].d).toBe("M0 0 L4 4");
  });

  it("renders as a vector item with the icon's view box for the PDF export", () => {
    const [item] = elementItems(createVector(iconArt(ALARM, "#ff0000"), 0, 0, 120, 120));
    expect(item.kind).toBe("vector");
    expect(item.kind === "vector" && [item.viewWidth, item.viewHeight]).toEqual([24, 24]);
    expect(item.kind === "vector" && item.paths[0].stroke).toMatchObject({ color: "#ff0000", width: 2, cap: "round", join: "round" });
  });

  it("draws Lucide's circle-check exactly as the sidecar export test expects", () => {
    const node = new Map(icons).get("CircleCheck") as IconNode;

    const [path] = iconArt(node, "#1f4e8c").paths;

    expect(path.d).toBe("M12 2 C17.523 2 22 6.477 22 12 C22 17.523 17.523 22 12 22 C6.477 22 2 17.523 2 12 C2 6.477 6.477 2 12 2 Z M9 12 L11 14 L15 10");
  });

  it("converts every icon of the library into supported path commands", () => {
    expect(icons.length).toBeGreaterThan(1000);
    for (const [name, node] of icons) {
      const art = iconArt(node, "#000000");
      expect(art.paths.length, name).toBeGreaterThan(0);
      for (const path of art.paths) expect(path.d, name).toMatch(/^M[-\d.eE ,MLCQZ]*$/);
    }
  });
});

describe("vector line width", () => {
  it("reports and changes the widest line in page points, scaling the others alike", () => {
    const element = createVector({ viewWidth: 24, viewHeight: 24, paths: [...iconArt(ALARM, "#000000").paths, { d: "M0 0L1 1", fill: { type: "none" }, stroke: { color: "#000000", width: 1, dash: "solid" }, evenOdd: false, opacity: 1 }] }, 0, 0, 120, 120);
    expect(vectorStrokeWidth(element)).toBe(10);
    const thinner = withVectorStrokeWidth(element, 5);
    expect(thinner.paths.map((path) => path.stroke?.width)).toEqual([1, 1, 0.5]);
    expect(withVectorStrokeWidth(element, 10)).toBe(element);
    expect(withVectorStrokeWidth(element, 0)).toBe(element);
  });

  it("has no line width when nothing is stroked", () => {
    const filled = createVector({ viewWidth: 10, viewHeight: 10, paths: [{ d: "M0 0L1 1Z", fill: { type: "solid", color: "#000000" }, stroke: null, evenOdd: false, opacity: 1 }] }, 0, 0, 10, 10);
    expect(vectorStrokeWidth(filled)).toBeNull();
    expect(withVectorStrokeWidth(filled, 3)).toBe(filled);
  });
});
