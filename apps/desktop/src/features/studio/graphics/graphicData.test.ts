import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_LOOK, newChart } from "@/features/viewer/overlay/chart/chartModel";
import { DEFAULT_FLOW_LOOK, newFlowchart } from "@/features/viewer/overlay/flowchart/flowchartModel";
import type { StudioSvgElement } from "@/types/studio";
import { createDesign, createSvg, placeholdersIn } from "../model/design";
import { elementItems } from "../model/render";
import { chartFrame, chartSpec, formulaSvg, graphicJob, graphicOf, graphicRenderSpec, keepsRatio, renderKeyOf, stretchSvg, tableScale, tableSpec, withRendered } from "./graphicData";
import { createTableData, setCellText, styleRange } from "./tableModel";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>';

function element(source: StudioSvgElement["source"], data: unknown, width = 300, height = 120): StudioSvgElement {
  return { ...createSvg(SVG, 10, 20, width, height), source, data };
}

const chart = (cells: string[][]) => newChart(DEFAULT_CHART_LOOK, cells);

describe("studio graphic data", () => {
  it("reads each graphic kind and refuses imports or broken data", () => {
    const flow = newFlowchart(DEFAULT_FLOW_LOOK, { start: "A", step: "B", end: "C" });

    expect(graphicOf(element("table", createTableData(2, 2)))?.kind).toBe("table");
    expect(graphicOf(element("chart", { kind: "chart", settings: chart([["", "S"], ["a", "1"]]), rendered: "" }))?.kind).toBe("chart");
    expect(graphicOf(element("flowchart", { kind: "flowchart", settings: flow, rendered: "", layout: null }))?.kind).toBe("flowchart");
    expect(graphicOf(element("formula", { kind: "formula", formula: { latex: "x", svg: SVG, color: "#111111", emWidth: 1, emHeight: 1 } }))?.kind).toBe("formula");
    expect(graphicOf(element("import", null))).toBeNull();
    expect(graphicOf(element("chart", { settings: { cells: "nope" } }))).toBeNull();
    expect(graphicOf(element("formula", { formula: { latex: "x", svg: "<script/>", emWidth: 1, emHeight: 1 } }))).toBeNull();
  });

  it("keeps the ratio of flowcharts and formulas only", () => {
    const flow = newFlowchart(DEFAULT_FLOW_LOOK, { start: "A", step: "B", end: "C" });

    expect(keepsRatio(element("flowchart", { kind: "flowchart", settings: flow, rendered: "", layout: null }))).toBe(true);
    expect(keepsRatio(element("table", createTableData(2, 2)))).toBe(false);
  });

  it("builds a table spec at the element width with cell styles only when used", () => {
    const plain = tableSpec(createTableData(2, 3), 300);
    const styled = tableSpec(styleRange(createTableData(2, 3), { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }, { fill: "#ff0000" }), 300);

    expect(plain.width).toBe(300);
    expect(plain.columnWidths).toHaveLength(3);
    expect(plain.cellStyles).toBeNull();
    expect(styled.cellStyles?.[0][0]).toEqual({ fill: "#ff0000" });
  });

  it("scales very wide tables into the engine range and keeps the visible text size", () => {
    const data = { ...createTableData(1, 1), fontSize: 24 };
    const spec = tableSpec(data, 4000);

    expect(tableScale(4000)).toBe(2);
    expect(spec.width).toBe(2000);
    expect(spec.fontSize).toBe(12);
    expect(tableSpec(data, 20).width).toBe(40);
  });

  it("frames charts inside the engine limits", () => {
    expect(chartFrame(300, 200)).toEqual({ width: 300, height: 200, scale: 1 });
    expect(chartFrame(2400, 1200)).toEqual({ width: 1200, height: 600, scale: 2 });
    expect(chartFrame(60, 40).scale).toBeCloseTo(0.5);
  });

  it("builds chart specs with negative numbers and nothing for empty data", () => {
    const settings = { ...chart([["", "Profit"], ["Q1", "-4"], ["Q2", "6,5"]]), legendPosition: "right" as const };
    const spec = chartSpec(settings, 400, 300);

    expect(spec?.series[0].values).toEqual([-4, 6.5]);
    expect(spec?.legendPosition).toBe("right");
    expect(spec?.width).toBe(400);
    expect(chartSpec(chart([["", "S"], ["a", ""]]), 400, 300)).toBeNull();
    expect(chartSpec({ ...settings, fontSize: 20 }, 2400, 1200)?.fontSize).toBe(10);
  });

  it("sends the graphic spec with the svg item so text stays real in the PDF", () => {
    const data = setCellText(createTableData(2, 2), { row: 0, column: 0 }, "{Name}");
    const [item] = elementItems(element("table", data));
    const imported = elementItems(element("import", null))[0];

    expect(item.kind === "svg" && item.graphic?.kind).toBe("table");
    expect(imported.kind === "svg" && imported.graphic).toBeUndefined();
    expect(graphicRenderSpec(element("formula", { kind: "formula", formula: { latex: "x", svg: SVG, color: "#111111", emWidth: 1, emHeight: 1 } }))).toBeNull();
  });

  it("lists table placeholders with the design placeholders", () => {
    const design = createDesign("Merge", 400, 400);
    const data = setCellText(createTableData(2, 2), { row: 1, column: 0 }, "{Name} {date}");

    expect(placeholdersIn({ ...design, pages: [{ ...design.pages[0], elements: [element("table", data)] }] })).toEqual(["Name"]);
  });

  it("asks for a render only when the spec changed", () => {
    const table = element("table", createTableData(2, 2));
    const job = graphicJob(table);
    const spec = graphicRenderSpec(table);

    expect(job?.key).toBe(spec ? renderKeyOf(spec) : "");
    const fresh = element("table", { ...createTableData(2, 2), rendered: job?.key });
    expect(graphicJob(fresh)).toBeNull();
    expect(graphicJob({ ...fresh, width: 400 })).not.toBeNull();
  });

  it("applies a rendered table by following its height", () => {
    const table = element("table", createTableData(2, 2), 300, 50);
    const job = graphicJob(table);
    if (!job) throw new Error("expected a job");

    const next = withRendered(table, job, { svg: SVG, width: 150, height: 40, rowHeights: [20, 20], columnWidths: [75, 75] });
    const graphic = graphicOf(next);

    expect(next.height).toBe(80);
    expect(next.svg).toContain('preserveAspectRatio="none"');
    expect(graphic?.kind === "table" && graphic.data.rendered).toBe(job.key);
    expect(graphic?.kind === "table" && graphic.data.layout?.rows).toEqual([20, 20]);
  });

  it("keeps a flowchart at its scale when its layout changes", () => {
    const flow = newFlowchart(DEFAULT_FLOW_LOOK, { start: "A", step: "B", end: "C" });
    const shape = element("flowchart", { kind: "flowchart", settings: flow, rendered: "", layout: { width: 100, height: 200 } }, 50, 100);
    const job = graphicJob(shape);
    if (!job) throw new Error("expected a job");

    const next = withRendered(shape, job, { svg: SVG, width: 120, height: 300 });

    expect(next.width).toBe(60);
    expect(next.height).toBe(150);
  });

  it("stretches svg markup to its box and recolours formulas", () => {
    expect(stretchSvg(SVG)).toMatch(/^<svg preserveAspectRatio="none"/);
    expect(stretchSvg('<svg preserveAspectRatio="xMidYMid" width="1">')).toBe('<svg preserveAspectRatio="none" width="1">');
    const svg = formulaSvg({ latex: "x", svg: '<svg viewBox="0 0 10 10" width="5ex"><path fill="currentColor"/></svg>', color: "#ff0000", emWidth: 2, emHeight: 1 });
    expect(svg).toContain('width="200"');
    expect(svg).toContain("#ff0000");
    expect(svg).not.toContain("5ex");
  });
});
