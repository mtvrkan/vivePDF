import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_LOOK, newChart } from "@/features/viewer/overlay/chart/chartModel";
import { DEFAULT_FLOW_LOOK, newFlowchart } from "@/features/viewer/overlay/flowchart/flowchartModel";
import type { StudioSvgElement } from "@/types/studio";
import { designColors, recolorDesign, recolorElement, uniqueElementColors } from "../model/colors";
import { createDesign, createSvg } from "../model/design";
import { graphicOf, graphicRenderSpec, renderKeyOf } from "./graphicData";
import { createTableData, styleRange } from "./tableModel";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path fill="#123456" d="M0 0h10v10z"/></svg>';

function element(source: StudioSvgElement["source"], data: unknown): StudioSvgElement {
  return { ...createSvg(SVG, 0, 0, 200, 100), source, data };
}

function table(): StudioSvgElement {
  const base = { ...createTableData(2, 2), color: "#111111", borderColor: "#333333", headerFill: "#dbeafe", stripes: false, stripeFill: "#f1f5f9" };
  return element("table", styleRange(base, { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } }, { fill: "#FF0000" }));
}

const chart = (type: "column" | "pie") => element("chart", { kind: "chart", settings: { ...newChart(DEFAULT_CHART_LOOK, [["", "Sales", "Costs"], ["A", "1", "2"]]), type, colors: ["#2563eb", "#f97316"], color: "#111111" }, rendered: "" });

describe("studio graphic colours", () => {
  it("lists a table's own colours instead of its preview markup", () => {
    expect(uniqueElementColors(table())).toEqual(["#111111", "#333333", "#dbeafe", "#ff0000"]);
  });

  it("swaps a table colour in its data so the export and the canvas both follow", () => {
    const original = table();

    const changed = recolorElement(original, "#ff0000", "#00ff00") as StudioSvgElement;

    const graphic = graphicOf(changed);
    expect(graphic?.kind === "table" && graphic.data.styles[1][1].fill).toBe("#00ff00");
    expect(changed.colorMap).toBeUndefined();
    expect(renderKeyOf(graphicRenderSpec(changed)!)).not.toBe(renderKeyOf(graphicRenderSpec(original)!));
  });

  it("swaps chart series colours but leaves pie slices on their palette", () => {
    const column = recolorElement(chart("column"), "#2563EB", "#000000");
    const pie = chart("pie");

    const columnGraphic = graphicOf(column);
    expect(columnGraphic?.kind === "chart" && columnGraphic.data.settings.colors).toEqual(["#000000", "#f97316"]);
    expect(uniqueElementColors(pie)).toEqual(["#111111"]);
    expect(recolorElement(pie, "#2563eb", "#000000")).toBe(pie);
  });

  it("recolours flowcharts and formulas across the design", () => {
    const flow = element("flowchart", { kind: "flowchart", settings: { ...newFlowchart(DEFAULT_FLOW_LOOK, { start: "A", step: "B", end: "C" }), stroke: "#1f2937" }, rendered: "", layout: null });
    const formula = element("formula", { kind: "formula", formula: { latex: "x", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="currentColor" d="M0 0h1v1z"/></svg>', color: "#1f2937", emWidth: 1, emHeight: 1 } });
    const design = createDesign("Graphics", 400, 400);

    const changed = recolorDesign({ ...design, pages: [{ ...design.pages[0], elements: [flow, formula] }] }, "#1f2937", "#aa0000");

    const [nextFlow, nextFormula] = changed.pages[0].elements.map((item) => graphicOf(item));
    expect(nextFlow?.kind === "flowchart" && nextFlow.data.settings.stroke).toBe("#aa0000");
    expect(nextFormula?.kind === "formula" && nextFormula.data.formula.color).toBe("#aa0000");
    expect((changed.pages[0].elements[1] as StudioSvgElement).svg).toContain("#aa0000");
    expect(designColors(changed)).toContain("#aa0000");
    expect(designColors(changed)).not.toContain("#1f2937");
  });
});
