import { describe, expect, it } from "vitest";
import en from "@/locales/en/common.json";
import tr from "@/locales/tr/common.json";
import { CHART_LIMITS, CHART_PALETTES, CHART_TYPES, DEFAULT_CHART_LOOK, applyChartEdit, applyPalette, cellKey, chartData, chartLook, decimalOf, newChart, parseChartNumber, sampleCells, setSeriesColor, type ChartSettings } from "./chartModel";

function chart(cells: string[][], change: Partial<ChartSettings> = {}): ChartSettings {
  return { ...newChart(DEFAULT_CHART_LOOK, cells), ...change };
}

describe("parseChartNumber", () => {
  it("reads numbers written with a decimal comma or point and with grouping", () => {
    const cases: Array<[string, number]> = [
      ["1,5", 1.5],
      ["1.5", 1.5],
      ["1.234,5", 1234.5],
      ["1,234.5", 1234.5],
      [" 12 000 ", 12000],
      ["1.234.567", 1234567],
      ["−2", -2],
      ["-0,25", -0.25],
      ["2e3", 2000],
    ];
    for (const [text, value] of cases) expect(parseChartNumber(text), text).toBeCloseTo(value);
  });

  it("refuses text that is not a number", () => {
    for (const text of ["", "abc", "12kg", "1-2", "Infinity", "NaN", "--1"]) expect(parseChartNumber(text), text).toBeNull();
  });
});

describe("chartData", () => {
  it("turns the grid into categories and series, skipping empty rows and columns", () => {
    const data = chartData(chart([["", "Sales", "", "Costs"], ["Jan", "4", "", "2,5"], ["", "", "", ""], ["Feb", "", "", "3"]]));
    expect(data.blank).toBe(false);
    expect(data.spec.categories).toEqual(["Jan", "Feb"]);
    expect(data.spec.series.map((series) => series.name)).toEqual(["Sales", "Costs"]);
    expect(data.spec.series[0].values).toEqual([4, null]);
    expect(data.spec.series[1].values).toEqual([2.5, 3]);
    expect(data.spec.series[1].color).toBe(CHART_PALETTES.vivid[2]);
  });

  it("marks cells that are not numbers and leaves them out", () => {
    const data = chartData(chart([["", "A"], ["x", "12kg"], ["y", "3"]]));
    expect(data.invalid).toEqual(new Set([cellKey(1, 1)]));
    expect(data.spec.series[0].values).toEqual([null, 3]);
  });

  it("asks a scatter chart for numbers in the first column", () => {
    const data = chartData(chart([["", "A"], ["one", "1"], ["2", "3"]], { type: "scatter" }));
    expect(data.invalid).toEqual(new Set([cellKey(1, 0)]));
  });

  it("is blank without any number, and stacks only chart types that can stack", () => {
    expect(chartData(chart([["", "A"], ["x", ""]])).blank).toBe(true);
    expect(chartData(chart([["", ""]])).blank).toBe(true);
    expect(chartData(chart([["", "A"], ["x", "1"]], { type: "line", stacked: true })).spec.stacked).toBe(false);
    expect(chartData(chart([["", "A"], ["x", "1"]], { type: "bar", stacked: true })).spec.stacked).toBe(true);
  });
});

describe("chart editing", () => {
  it("keeps each series colour with its column when columns come and go", () => {
    let settings = setSeriesColor(chart([["", "A", "B"], ["x", "1", "2"]]), 1, "#123456");
    settings = applyChartEdit(settings, { kind: "addColumn", at: 1 });
    expect(settings.colors).toEqual([CHART_PALETTES.vivid[0], CHART_PALETTES.vivid[0], "#123456"]);
    settings = applyChartEdit(settings, { kind: "removeColumn", column: 1 });
    expect(settings.colors).toEqual([CHART_PALETTES.vivid[0], "#123456"]);
  });

  it("keeps at least one series and stops at eight", () => {
    const one = chart([["", "A"]]);
    expect(applyChartEdit(one, { kind: "removeColumn", column: 1 })).toBe(one);
    const full = chart([Array.from({ length: CHART_LIMITS.columns }, () => "")]);
    expect(applyChartEdit(full, { kind: "addColumn" })).toBe(full);
  });

  it("recolours every series from a new palette", () => {
    const settings = applyPalette(chart([["", "A", "B"]]), "forest");
    expect(settings.colors).toEqual([CHART_PALETTES.forest[0], CHART_PALETTES.forest[1]]);
  });
});

describe("new charts", () => {
  it("start from sample data in the chosen look and remember only the look", () => {
    const cells = sampleCells((number) => `S${number}`, (number) => `C${number}`);
    const settings = newChart({ ...DEFAULT_CHART_LOOK, palette: "ocean" }, cells);
    expect(settings.colors).toEqual([CHART_PALETTES.ocean[0], CHART_PALETTES.ocean[1]]);
    expect(chartData(settings).spec.categories).toEqual(["C1", "C2", "C3", "C4"]);
    expect(chartLook({ ...settings, title: "kept?" })).not.toHaveProperty("title");
  });

  it("uses the interface language's decimal mark", () => {
    expect(decimalOf("tr")).toBe(",");
    expect(decimalOf("en")).toBe(".");
  });
});

describe("sample charts", () => {
  const scores = [["", "Class A"], ["", "45"], ["", "72"], ["", "72"]];

  it("sends a chosen bin count only for a histogram", () => {
    expect(chartData(chart(scores, { type: "histogram", bins: 6 })).spec.bins).toBe(6);
    expect(chartData(chart(scores, { type: "histogram", bins: 0 })).spec.bins).toBeNull();
    expect(chartData(chart(scores, { type: "box", bins: 6 })).spec.bins).toBeNull();
  });

  it("keeps rows whose first column is empty so raw observations count", () => {
    const data = chartData(chart(scores, { type: "dotplot" }));
    expect(data.blank).toBe(false);
    expect(data.spec.series[0].values).toEqual([45, 72, 72]);
  });

  it("names every chart type in English and Turkish", () => {
    for (const type of CHART_TYPES) {
      expect(en.viewer.chart.types[type]).toBeTruthy();
      expect(tr.viewer.chart.types[type]).toBeTruthy();
    }
  });
});
