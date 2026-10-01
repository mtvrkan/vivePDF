import type { EditorPending } from "@/shared/store/viewerOverlayStore";
import type { EditorChartObject, EditorDrawingObject, EditorFlowchartObject, EditorQuestionObject, EditorTableObject } from "@/types";
import { chartData } from "../chart/chartModel";
import type { ChartSource } from "../chart/chartObject";
import { coloredFormulaSvg, type FormulaSource } from "../formula/formulaSvg";
import { toFlowchartSpec } from "../flowchart/flowchartModel";
import type { FlowchartSource } from "../flowchart/flowchartObject";
import type { GraphSource } from "../graph/graphObject";
import type { MoleculeSource } from "../molecule/moleculeObject";
import { toAnswerKeyTable } from "../question/answerKeyModel";
import { toQuestionSpec } from "../question/questionModel";
import type { AnswerKeySource, QuestionSource } from "../question/questionObject";
import type { ShapeSource } from "../shapes/shapeObject";
import { toTableSpec } from "../table/tableModel";
import type { TableSource } from "../table/tableObject";

export type DrawingSources = { formula: FormulaSource; shape: ShapeSource; graph: GraphSource; molecule: MoleculeSource; table: TableSource; chart: ChartSource; question: QuestionSource; answerKey: AnswerKeySource; flowchart: FlowchartSource };
export type DrawingKind = keyof DrawingSources;
export type DrawingOf<K extends DrawingKind> = { kind: K; source: DrawingSources[K] };
export type DrawingSource = { [K in DrawingKind]: DrawingOf<K> }[DrawingKind];
export type DrawingImage<K extends DrawingKind = DrawingKind> = Extract<EditorPending, { kind: "image" }> & { drawing: { [P in K]: DrawingOf<P> }[K] };

export const DRAWING_KINDS: readonly DrawingKind[] = ["formula", "shape", "graph", "molecule", "table", "chart", "flowchart", "question", "answerKey"];

export function isDrawingImage(item: EditorPending | null | undefined): item is DrawingImage {
  return !!item && item.kind === "image" && !!item.drawing;
}

export function isDrawingKind<K extends DrawingKind>(item: EditorPending | null | undefined, kind: K): item is DrawingImage<K> {
  return isDrawingImage(item) && item.drawing.kind === kind;
}

export function drawingSvg(drawing: DrawingSource): string {
  switch (drawing.kind) {
    case "formula":
      return coloredFormulaSvg(drawing.source.svg, drawing.source.color);
    case "shape":
    case "graph":
    case "molecule":
    case "table":
    case "chart":
    case "question":
    case "answerKey":
    case "flowchart":
      return drawing.source.svg;
  }
}

export function toDrawingObject(item: DrawingImage, alt?: string): EditorDrawingObject | EditorTableObject | EditorChartObject | EditorQuestionObject | EditorFlowchartObject {
  const box = { id: item.id, page: item.pageIndex + 1, x0: item.x, y0: item.y, x1: item.x + item.width, y1: item.y + item.height, opacity: item.opacity, ...(alt ? { alt } : {}) };
  if (item.drawing.kind === "table") return { ...toTableSpec(item.drawing.source.settings), ...box, kind: "table" };
  if (item.drawing.kind === "chart") return { ...chartData(item.drawing.source.settings).spec, ...box, kind: "chart" };
  if (item.drawing.kind === "question") return { ...toQuestionSpec(item.drawing.source.settings), ...box, kind: "question" };
  if (item.drawing.kind === "flowchart") return { ...toFlowchartSpec(item.drawing.source.settings), ...box, kind: "flowchart" };
  if (item.drawing.kind === "answerKey") return { ...toAnswerKeyTable(item.drawing.source.settings), ...box, kind: "table" };
  return { ...box, kind: "drawing", svg: drawingSvg(item.drawing) };
}
