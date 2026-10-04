import { paletteColor, type ChartSettings } from "@/features/viewer/overlay/chart/chartModel";
import type { FlowchartSettings } from "@/features/viewer/overlay/flowchart/flowchartModel";
import type { StudioSvgElement } from "@/types/studio";
import { formulaSvg, type StudioGraphic } from "./graphicData";
import type { StudioTableData } from "./tableModel";

type Swap = (color: string) => string;

const PALETTE_CHARTS = new Set<ChartSettings["type"]>(["pie", "doughnut"]);

function present(colors: (string | null | undefined)[]): string[] {
  return colors.filter((color): color is string => Boolean(color));
}

function seriesColors(settings: ChartSettings): string[] {
  if (PALETTE_CHARTS.has(settings.type)) return [];
  const count = Math.max(0, (settings.cells[0]?.length ?? 1) - 1);
  return Array.from({ length: count }, (_, index) => settings.colors[index] ?? paletteColor(settings.palette, index));
}

function tableColors(data: StudioTableData): string[] {
  const cells = data.styles.flatMap((row) => row.flatMap((style) => present([style.fill, style.color])));
  return present([data.color, data.borderColor, data.headerFill, data.stripes ? data.stripeFill : null, ...cells]);
}

function flowchartColors(settings: FlowchartSettings): string[] {
  return present([settings.color, settings.stroke, settings.fill]);
}

export function graphicColors(graphic: StudioGraphic): string[] {
  switch (graphic.kind) {
    case "table":
      return tableColors(graphic.data);
    case "chart":
      return [...seriesColors(graphic.data.settings), graphic.data.settings.color];
    case "flowchart":
      return flowchartColors(graphic.data.settings);
    case "formula":
      return [graphic.data.formula.color];
  }
}

function swapOptional(color: string | null, swap: Swap): string | null {
  return color ? swap(color) : color;
}

function swapTable(data: StudioTableData, swap: Swap): StudioTableData {
  return {
    ...data,
    color: swap(data.color),
    borderColor: swap(data.borderColor),
    headerFill: swapOptional(data.headerFill, swap),
    stripeFill: swapOptional(data.stripeFill, swap),
    styles: data.styles.map((row) =>
      row.map((style) => ({ ...style, ...(style.fill ? { fill: swap(style.fill) } : {}), ...(style.color ? { color: swap(style.color) } : {}) })),
    ),
  };
}

function swapChart(settings: ChartSettings, swap: Swap): ChartSettings {
  const colors = PALETTE_CHARTS.has(settings.type) ? settings.colors : seriesColors(settings).map(swap);
  return { ...settings, colors, color: swap(settings.color) };
}

function swapFlowchart(settings: FlowchartSettings, swap: Swap): FlowchartSettings {
  return { ...settings, color: swap(settings.color), stroke: swap(settings.stroke), fill: swapOptional(settings.fill, swap) };
}

function changed(before: string[], after: string[]): boolean {
  return before.length !== after.length || before.some((color, index) => color.toLowerCase() !== after[index].toLowerCase());
}

export function swapGraphicColors(element: StudioSvgElement, graphic: StudioGraphic, swap: Swap): StudioSvgElement {
  const before = graphicColors(graphic);
  if (!changed(before, before.map(swap))) return element;
  switch (graphic.kind) {
    case "table":
      return { ...element, data: swapTable(graphic.data, swap) };
    case "chart":
      return { ...element, data: { ...graphic.data, settings: swapChart(graphic.data.settings, swap) } };
    case "flowchart":
      return { ...element, data: { ...graphic.data, settings: swapFlowchart(graphic.data.settings, swap) } };
    case "formula": {
      const formula = { ...graphic.data.formula, color: swap(graphic.data.formula.color) };
      return { ...element, svg: formulaSvg(formula), data: { ...graphic.data, formula } };
    }
  }
}
