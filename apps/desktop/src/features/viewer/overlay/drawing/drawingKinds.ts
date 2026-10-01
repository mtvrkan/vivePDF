import type { ComponentType } from "react";
import type { TFunction } from "i18next";
import { Atom, ChartColumn, ChartSpline, KeyRound, ListChecks, Shapes, Sigma, Table2, Workflow, type LucideIcon } from "lucide-react";
import { ChartEditorHost } from "../chart/ChartEditorHost";
import { FlowchartEditorHost } from "../flowchart/FlowchartEditorHost";
import { FormulaEditorHost } from "../formula/FormulaEditorHost";
import { GraphEditorHost } from "../graph/GraphEditorHost";
import { MoleculeEditorHost } from "../molecule/MoleculeEditorHost";
import { AnswerKeyEditorHost } from "../question/AnswerKeyEditorHost";
import { filledRows } from "../question/answerKeyModel";
import { QuestionEditorHost } from "../question/QuestionEditorHost";
import { ShapeEditorHost } from "../shapes/ShapeEditorHost";
import { TableEditorHost } from "../table/TableEditorHost";
import { answerKeyAlt, chartAlt, flowchartAlt, formulaAlt, graphAlt, moleculeAlt, questionAlt, shapeAlt, tableAlt, tidyAlt } from "./drawingAltText";
import type { DrawingKind, DrawingSource, DrawingSources } from "./drawingSource";

type DrawingKindSpec<K extends DrawingKind> = {
  icon: LucideIcon;
  labels: { menu: string; pick: string; edit: string; placeHint: string; added: string };
  layerLabel: (source: DrawingSources[K], t: TFunction) => string;
  altText: (source: DrawingSources[K], t: TFunction) => string;
  Host: ComponentType<{ objectId: string | null }>;
};

export const DRAWING_SPECS: { [K in DrawingKind]: DrawingKindSpec<K> } = {
  formula: {
    icon: Sigma,
    labels: { menu: "viewer.formula.menu", pick: "viewer.formula.pick", edit: "viewer.formula.edit", placeHint: "viewer.formula.placeHint", added: "viewer.editPanel.formulaAdded" },
    layerLabel: (source, t) => t("viewer.editPanel.layers.formula", { latex: source.latex.replace(/\s+/g, " ").trim().slice(0, 32) }),
    altText: formulaAlt,
    Host: FormulaEditorHost,
  },
  shape: {
    icon: Shapes,
    labels: { menu: "viewer.shapes.menu", pick: "viewer.shapes.pick", edit: "viewer.shapes.edit", placeHint: "viewer.shapes.placeHint", added: "viewer.editPanel.shapeAdded" },
    layerLabel: (source, t) => t("viewer.editPanel.layers.shape", { name: t(`viewer.shapes.names.${source.id}`) }),
    altText: shapeAlt,
    Host: ShapeEditorHost,
  },
  graph: {
    icon: ChartSpline,
    labels: { menu: "viewer.graph.menu", pick: "viewer.graph.pick", edit: "viewer.graph.edit", placeHint: "viewer.graph.placeHint", added: "viewer.editPanel.graphAdded" },
    layerLabel: (source, t) => t("viewer.editPanel.layers.graph", { expression: source.settings.functions.map((entry) => entry.expression.trim()).filter(Boolean).join("; ") }),
    altText: graphAlt,
    Host: GraphEditorHost,
  },
  molecule: {
    icon: Atom,
    labels: { menu: "viewer.molecule.menu", pick: "viewer.molecule.pick", edit: "viewer.molecule.edit", placeHint: "viewer.molecule.placeHint", added: "viewer.editPanel.moleculeAdded" },
    layerLabel: (source, t) => t("viewer.editPanel.layers.molecule", { smiles: source.settings.smiles.slice(0, 32) }),
    altText: moleculeAlt,
    Host: MoleculeEditorHost,
  },
  table: {
    icon: Table2,
    labels: { menu: "viewer.table.menu", pick: "viewer.table.pick", edit: "viewer.table.edit", placeHint: "viewer.table.placeHint", added: "viewer.editPanel.tableAdded" },
    layerLabel: (source, t) => {
      const first = source.settings.cells.flat().find((text) => text.trim())?.trim().slice(0, 24);
      const size = { rows: source.settings.cells.length, columns: source.settings.align.length };
      return first ? t("viewer.editPanel.layers.tableNamed", { ...size, first }) : t("viewer.editPanel.layers.table", size);
    },
    altText: tableAlt,
    Host: TableEditorHost,
  },
  chart: {
    icon: ChartColumn,
    labels: { menu: "viewer.chart.menu", pick: "viewer.chart.pick", edit: "viewer.chart.edit", placeHint: "viewer.chart.placeHint", added: "viewer.editPanel.chartAdded" },
    layerLabel: (source, t) => t("viewer.editPanel.layers.chart", { name: source.settings.title.trim().slice(0, 32) || t(`viewer.chart.types.${source.settings.type}`) }),
    altText: chartAlt,
    Host: ChartEditorHost,
  },
  flowchart: {
    icon: Workflow,
    labels: { menu: "viewer.flowchart.menu", pick: "viewer.flowchart.pick", edit: "viewer.flowchart.edit", placeHint: "viewer.flowchart.placeHint", added: "viewer.editPanel.flowchartAdded" },
    layerLabel: (source, t) => {
      const first = source.settings.nodes.find((node) => node.text.trim())?.text.replace(/\s+/g, " ").trim().slice(0, 32) ?? "";
      return t("viewer.editPanel.layers.flowchart", { first });
    },
    altText: flowchartAlt,
    Host: FlowchartEditorHost,
  },
  question: {
    icon: ListChecks,
    labels: { menu: "viewer.question.menu", pick: "viewer.question.pick", edit: "viewer.question.edit", placeHint: "viewer.question.placeHint", added: "viewer.editPanel.questionAdded" },
    layerLabel: (source, t) => {
      const stem = source.settings.stem.replace(/\s+/g, " ").trim().slice(0, 32);
      return source.settings.number === null ? t("viewer.editPanel.layers.question", { stem }) : t("viewer.editPanel.layers.questionNumbered", { number: source.settings.number, stem });
    },
    altText: questionAlt,
    Host: QuestionEditorHost,
  },
  answerKey: {
    icon: KeyRound,
    labels: { menu: "viewer.answerKey.menu", pick: "viewer.answerKey.pick", edit: "viewer.answerKey.edit", placeHint: "viewer.answerKey.placeHint", added: "viewer.editPanel.answerKeyAdded" },
    layerLabel: (source, t) => t("viewer.editPanel.layers.answerKey", { count: filledRows(source.settings).length }),
    altText: answerKeyAlt,
    Host: AnswerKeyEditorHost,
  },
};

export function drawingLayerLabel(drawing: DrawingSource, t: TFunction): string {
  switch (drawing.kind) {
    case "formula":
      return DRAWING_SPECS.formula.layerLabel(drawing.source, t);
    case "shape":
      return DRAWING_SPECS.shape.layerLabel(drawing.source, t);
    case "graph":
      return DRAWING_SPECS.graph.layerLabel(drawing.source, t);
    case "molecule":
      return DRAWING_SPECS.molecule.layerLabel(drawing.source, t);
    case "table":
      return DRAWING_SPECS.table.layerLabel(drawing.source, t);
    case "chart":
      return DRAWING_SPECS.chart.layerLabel(drawing.source, t);
    case "flowchart":
      return DRAWING_SPECS.flowchart.layerLabel(drawing.source, t);
    case "question":
      return DRAWING_SPECS.question.layerLabel(drawing.source, t);
    case "answerKey":
      return DRAWING_SPECS.answerKey.layerLabel(drawing.source, t);
  }
}

export function drawingAltText(drawing: DrawingSource, t: TFunction): string {
  switch (drawing.kind) {
    case "formula":
      return tidyAlt(DRAWING_SPECS.formula.altText(drawing.source, t));
    case "shape":
      return tidyAlt(DRAWING_SPECS.shape.altText(drawing.source, t));
    case "graph":
      return tidyAlt(DRAWING_SPECS.graph.altText(drawing.source, t));
    case "molecule":
      return tidyAlt(DRAWING_SPECS.molecule.altText(drawing.source, t));
    case "table":
      return tidyAlt(DRAWING_SPECS.table.altText(drawing.source, t));
    case "chart":
      return tidyAlt(DRAWING_SPECS.chart.altText(drawing.source, t));
    case "flowchart":
      return tidyAlt(DRAWING_SPECS.flowchart.altText(drawing.source, t));
    case "question":
      return tidyAlt(DRAWING_SPECS.question.altText(drawing.source, t));
    case "answerKey":
      return tidyAlt(DRAWING_SPECS.answerKey.altText(drawing.source, t));
  }
}
