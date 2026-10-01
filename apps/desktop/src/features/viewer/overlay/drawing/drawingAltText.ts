import type { TFunction } from "i18next";
import { chartData } from "../chart/chartModel";
import type { ChartSource } from "../chart/chartObject";
import type { FlowchartSource } from "../flowchart/flowchartObject";
import type { FormulaSource } from "../formula/formulaSvg";
import type { GraphSource } from "../graph/graphObject";
import { LEGEND_NAMES } from "../graph/plot";
import type { MoleculeSource } from "../molecule/moleculeObject";
import { filledRows } from "../question/answerKeyModel";
import { optionLetter, toQuestionSpec } from "../question/questionModel";
import type { AnswerKeySource, QuestionSource } from "../question/questionObject";
import type { ShapeSource } from "../shapes/shapeObject";
import type { TableSource } from "../table/tableObject";

export const MAX_ALT_CHARS = 2000;

export function tidyAlt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_ALT_CHARS ? `${flat.slice(0, MAX_ALT_CHARS - 1)}…` : flat;
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function rowsText(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map(flat).filter(Boolean).join(", "))
    .filter(Boolean)
    .join("; ");
}

export function formulaAlt(source: FormulaSource, t: TFunction): string {
  return t("viewer.altText.formula", { latex: flat(source.latex) });
}

export function shapeAlt(source: ShapeSource, t: TFunction): string {
  return t("viewer.altText.shape", { name: t(`viewer.shapes.names.${source.id}`) });
}

export function graphAlt(source: GraphSource, t: TFunction): string {
  const { settings } = source;
  const functions = settings.functions
    .map((entry, index) => ({ name: LEGEND_NAMES[index], expression: flat(entry.expression) }))
    .filter((entry) => entry.expression)
    .map((entry) => `${entry.name}(x) = ${entry.expression}`)
    .join("; ");
  return t("viewer.altText.graph", { functions, xMin: settings.xMin, xMax: settings.xMax });
}

export function moleculeAlt(source: MoleculeSource, t: TFunction): string {
  return t("viewer.altText.molecule", { smiles: source.settings.smiles });
}

export function tableAlt(source: TableSource, t: TFunction): string {
  const { cells, align } = source.settings;
  return t("viewer.altText.table", { rows: cells.length, columns: align.length, content: rowsText(cells) });
}

function formatValue(value: number | null): string {
  return value === null ? "–" : String(value);
}

export function chartAlt(source: ChartSource, t: TFunction): string {
  const { spec } = chartData(source.settings);
  const type = t(`viewer.chart.types.${spec.type}`);
  const hasCategories = spec.categories.some((category) => category !== "");
  const content = hasCategories
    ? spec.categories.map((category, index) => `${category}: ${spec.series.map((series) => `${series.name} ${formatValue(series.values[index] ?? null)}`.trim()).join(", ")}`).join("; ")
    : spec.series.map((series) => `${series.name}: ${series.values.map(formatValue).join(", ")}`).join("; ");
  const title = spec.title ?? "";
  return title ? t("viewer.altText.chartTitled", { type, title, content }) : t("viewer.altText.chart", { type, content });
}

export function questionAlt(source: QuestionSource, t: TFunction): string {
  const spec = toQuestionSpec(source.settings);
  const stem = flat(spec.stem ?? "");
  const head = spec.number === null || spec.number === undefined ? t("viewer.altText.question", { stem }) : t("viewer.altText.questionNumbered", { number: spec.number, stem });
  const options = (spec.options ?? []).map((option, index) => `${optionLetter(index, spec.letterCase ?? "upper")}) ${flat(option)}`);
  return options.length ? `${head} ${t("viewer.altText.options", { list: options.join("; ") })}` : head;
}

export function answerKeyAlt(source: AnswerKeySource, t: TFunction): string {
  return t("viewer.altText.answerKey", { content: filledRows(source.settings).map((row) => row.map(flat).join(" ")).join(", ") });
}

export function flowchartAlt(source: FlowchartSource, t: TFunction): string {
  const { nodes, edges } = source.settings;
  const names = new Map(nodes.map((node, index) => [node.id, flat(node.text) || String(index + 1)]));
  const steps = nodes.map((node, index) => `${index + 1}. ${names.get(node.id)}`).join("; ");
  const arrows = edges
    .filter((edge) => names.has(edge.source) && names.has(edge.target) && edge.source !== edge.target)
    .map((edge) => {
      const label = flat(edge.label);
      return `${names.get(edge.source)} → ${names.get(edge.target)}${label ? ` (${label})` : ""}`;
    })
    .join("; ");
  return arrows ? t("viewer.altText.flowchart", { steps, arrows }) : t("viewer.altText.flowchartSteps", { steps });
}
