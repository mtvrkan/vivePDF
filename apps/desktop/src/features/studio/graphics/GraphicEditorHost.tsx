import { useState } from "react";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/app/i18n";
import { ChartDialog } from "@/features/viewer/overlay/chart/ChartDialog";
import { DEFAULT_CHART_LOOK, chartLook, decimalOf, newChart, sampleCells, type ChartLook, type ChartSettings } from "@/features/viewer/overlay/chart/chartModel";
import type { ChartSource } from "@/features/viewer/overlay/chart/chartObject";
import { FlowchartDialog } from "@/features/viewer/overlay/flowchart/FlowchartDialog";
import { DEFAULT_FLOW_LOOK, flowchartLook, newFlowchart, toFlowchartSpec, type FlowchartLook } from "@/features/viewer/overlay/flowchart/flowchartModel";
import type { FlowchartSource } from "@/features/viewer/overlay/flowchart/flowchartObject";
import { FormulaDialog, type FormulaDraft, type FormulaSubmit } from "@/features/viewer/overlay/formula/FormulaDialog";
import { DEFAULT_FORMULA_COLOR, DEFAULT_FORMULA_SIZE, formulaBox, formulaSizeOf } from "@/features/viewer/overlay/formula/formulaSvg";
import type { StudioPage, StudioSvgElement } from "@/types/studio";
import { centred, insert } from "../design/insert";
import { currentPage, useStudioStore } from "../design/studioStore";
import { chartFrame, chartSpec, formulaSvg, graphicOf, renderKeyOf, stretchSvg } from "./graphicData";
import { createGraphicElement, graphicSwatchRows, patchGraphic, useGraphicEditor, type GraphicRequest } from "./graphicEditor";

const NEW_CHART_SHARE = 0.7;
const NEW_CHART_MAX = 480;
const NEW_FLOW_SHARE = 0.8;

let lastChartLook: ChartLook | null = null;
let lastFlowLook: FlowchartLook = DEFAULT_FLOW_LOOK;
let lastFormula: Pick<FormulaDraft, "color" | "size"> = { color: DEFAULT_FORMULA_COLOR, size: DEFAULT_FORMULA_SIZE };

function useTarget(request: GraphicRequest): { page: StudioPage | null; element: StudioSvgElement | null } {
  const page = useStudioStore((state) => currentPage(state));
  const element = request.elementId ? (page?.elements.find((item): item is StudioSvgElement => item.id === request.elementId && item.kind === "svg") ?? null) : null;
  return { page, element };
}

function designPalette(): string[] {
  return useStudioStore.getState().design?.palette ?? [];
}

function chartColours(settings: ChartSettings): ChartSettings {
  const palette = designPalette();
  if (palette.length < 2) return settings;
  return { ...settings, colors: settings.colors.map((_, index) => palette[index % palette.length]) };
}

function chartBox(page: StudioPage): { width: number; height: number } {
  const width = Math.min(page.width * NEW_CHART_SHARE, NEW_CHART_MAX);
  const height = Math.min(width * (2 / 3), page.height * NEW_CHART_SHARE);
  return { width, height };
}

function ChartHost({ request, onClose }: { request: Extract<GraphicRequest, { kind: "chart" }>; onClose: () => void }) {
  const { t } = useTranslation();
  const { page, element } = useTarget(request);
  const graphic = element ? graphicOf(element) : null;
  const editing = element && graphic?.kind === "chart" ? { element, settings: graphic.data.settings } : null;
  const [box] = useState(() => (editing ? { width: editing.element.width, height: editing.element.height } : page ? chartBox(page) : { width: 360, height: 240 }));
  const frame = chartFrame(box.width, box.height);
  const [initial] = useState<ChartSettings>(() => {
    if (editing) return { ...editing.settings, width: frame.width, height: frame.height, fontSize: editing.settings.fontSize / frame.scale };
    const look = { ...(lastChartLook ?? DEFAULT_CHART_LOOK), ...(request.chartType ? { type: request.chartType } : {}), decimal: decimalOf(currentLocale()), width: frame.width, height: frame.height };
    return chartColours(
      newChart(
        look,
        sampleCells(
          (number) => t("viewer.chart.sample.series", { number }),
          (number) => t("viewer.chart.sample.category", { number }),
        ),
      ),
    );
  });
  if (!page) return null;

  const submit = (source: ChartSource) => {
    const settings: ChartSettings = { ...source.settings, fontSize: source.settings.fontSize * frame.scale };
    lastChartLook = chartLook(settings);
    const spec = chartSpec(settings, box.width, box.height);
    const data = { kind: "chart", settings, rendered: spec ? renderKeyOf({ kind: "chart", spec }) : "" };
    if (editing) patchGraphic(editing.element.id, () => ({ svg: stretchSvg(source.svg), data }));
    else insert(createGraphicElement("chart", source.svg, { ...centred(page, box.width, box.height), ...box }, data));
    onClose();
  };

  return <ChartDialog initial={initial} updating={!!editing} onClose={onClose} onSubmit={submit} swatchRows={() => graphicSwatchRows(t)} fixedSize />;
}

function FlowchartHost({ request, onClose }: { request: Extract<GraphicRequest, { kind: "flowchart" }>; onClose: () => void }) {
  const { t } = useTranslation();
  const { page, element } = useTarget(request);
  const graphic = element ? graphicOf(element) : null;
  const editing = element && graphic?.kind === "flowchart" ? { element, data: graphic.data } : null;
  const [initial] = useState(() => (editing ? editing.data.settings : newFlowchart(lastFlowLook, { start: t("viewer.flowchart.sample.start"), step: t("viewer.flowchart.sample.step"), end: t("viewer.flowchart.sample.end") })));
  if (!page) return null;

  const submit = (source: FlowchartSource) => {
    lastFlowLook = flowchartLook(source.settings);
    const data = { kind: "flowchart", settings: source.settings, rendered: renderKeyOf({ kind: "flowchart", spec: toFlowchartSpec(source.settings) }), layout: { width: source.width, height: source.height } };
    if (editing) {
      const scale = editing.element.width / (editing.data.layout?.width ?? source.width);
      patchGraphic(editing.element.id, () => ({ svg: stretchSvg(source.svg), width: source.width * scale, height: source.height * scale, data }));
    } else {
      const scale = Math.min(1, (page.width * NEW_FLOW_SHARE) / source.width, (page.height * NEW_FLOW_SHARE) / source.height);
      const width = source.width * scale;
      const height = source.height * scale;
      insert(createGraphicElement("flowchart", source.svg, { ...centred(page, width, height), width, height }, data));
    }
    onClose();
  };

  return <FlowchartDialog initial={initial} updating={!!editing} onClose={onClose} onSubmit={submit} swatchRows={() => graphicSwatchRows(t)} />;
}

function FormulaHost({ request, onClose }: { request: Extract<GraphicRequest, { kind: "formula" }>; onClose: () => void }) {
  const { t } = useTranslation();
  const { page, element } = useTarget(request);
  const graphic = element ? graphicOf(element) : null;
  const editing = element && graphic?.kind === "formula" ? { element, formula: graphic.data.formula } : null;
  const [initial] = useState<FormulaDraft>(() => (editing ? { latex: editing.formula.latex, color: editing.formula.color, size: formulaSizeOf(editing.formula, editing.element.width) } : { latex: "", ...lastFormula }));
  if (!page) return null;

  const submit = ({ formula, size }: FormulaSubmit) => {
    lastFormula = { color: formula.color, size };
    const box = formulaBox(formula, size);
    const data = { kind: "formula", formula };
    if (editing) patchGraphic(editing.element.id, () => ({ svg: formulaSvg(formula), width: box.width, height: box.height, data }));
    else insert(createGraphicElement("formula", formulaSvg(formula), { ...centred(page, box.width, box.height), ...box }, data));
    onClose();
  };

  return <FormulaDialog initial={initial} updating={!!editing} onClose={onClose} onSubmit={submit} swatchRows={() => graphicSwatchRows(t)} />;
}

export function GraphicEditorHost() {
  const request = useGraphicEditor((state) => state.request);
  const close = useGraphicEditor((state) => state.close);
  if (!request) return null;
  const key = `${request.kind}-${request.elementId ?? "new"}`;
  switch (request.kind) {
    case "chart":
      return <ChartHost key={key} request={request} onClose={close} />;
    case "flowchart":
      return <FlowchartHost key={key} request={request} onClose={close} />;
    case "formula":
      return <FormulaHost key={key} request={request} onClose={close} />;
  }
}
