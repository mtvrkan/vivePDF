import { beforeAll, describe, expect, it } from "vitest";
import i18n from "i18next";
import { ready, setLocale } from "@/app/i18n";
import en from "@/locales/en/common.json";
import tr from "@/locales/tr/common.json";
import type { EditorPending } from "@/shared/store/viewerOverlayStore";
import { DEFAULT_SHAPE_STYLE } from "../shapes/render";
import { DEFAULT_GRAPH } from "../graph/plot";
import { DEFAULT_TABLE } from "../table/tableModel";
import { CHART_PALETTES, DEFAULT_CHART_LOOK, newChart } from "../chart/chartModel";
import { DEFAULT_FLOW_LOOK, newFlowchart } from "../flowchart/flowchartModel";
import { DEFAULT_MOLECULE_LOOK } from "../molecule/moleculeModel";
import { DEFAULT_ANSWER_KEY_LOOK, newAnswerKey } from "../question/answerKeyModel";
import { DEFAULT_QUESTION_LOOK, newQuestion } from "../question/questionModel";
import { MAX_ALT_CHARS } from "./drawingAltText";
import { DRAWING_SPECS, drawingAltText, drawingLayerLabel } from "./drawingKinds";
import { DRAWING_KINDS, isDrawingImage, isDrawingKind, toDrawingObject, type DrawingSource } from "./drawingSource";

function lookup(catalog: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalog);
}

const formula: DrawingSource = { kind: "formula", source: { latex: "a^2  +\n b^2", svg: '<svg viewBox="0 0 1 1"><path fill="currentColor"/></svg>', color: "#123456", emWidth: 2, emHeight: 1 } };
const shape: DrawingSource = { kind: "shape", source: { id: "cone", params: {}, style: DEFAULT_SHAPE_STYLE, svg: "<svg/>", width: 10, height: 10 } };
const graph: DrawingSource = { kind: "graph", source: { settings: { ...DEFAULT_GRAPH, functions: [{ expression: " x^2 ", color: "#000000" }, { expression: "", color: "#000000" }, { expression: "sin x", color: "#000000" }] }, svg: "<svg/>", width: 10, height: 10 } };

const table: DrawingSource = { kind: "table", source: { settings: { ...DEFAULT_TABLE, cells: [["", " Name ", "Age"], ["Ada", "36", ""]], align: ["left", "center", "right"], widthMode: "fit" }, svg: "<svg/>", width: 10, height: 10 } };
const chartSettings = newChart({ ...DEFAULT_CHART_LOOK, type: "pie" }, [["", "Share"], ["Tea", "3"], ["Coffee", "1,5"]]);
const chart: DrawingSource = { kind: "chart", source: { settings: chartSettings, svg: "<svg/>", width: 10, height: 10 } };
const questionSettings = { ...newQuestion(DEFAULT_QUESTION_LOOK, 7), stem: "  Which city is\n the capital?", options: ["Paris", "Ankara"], answer: 1 };
const question: DrawingSource = { kind: "question", source: { settings: questionSettings, svg: "<svg/>", width: 10, height: 10 } };
const unnumbered: DrawingSource = { kind: "question", source: { settings: { ...questionSettings, number: null }, svg: "<svg/>", width: 10, height: 10 } };
const answerKey: DrawingSource = { kind: "answerKey", source: { settings: { ...newAnswerKey(DEFAULT_ANSWER_KEY_LOOK, { number: "No", answer: "Key" }, [[1, "A"], [2, "C"], [3, ""]]), groups: 2 }, svg: "<svg/>", width: 10, height: 10 } };
const flowchart: DrawingSource = { kind: "flowchart", source: { settings: newFlowchart(DEFAULT_FLOW_LOOK, { start: "  Begin\n here ", step: "Work", end: "Stop" }), svg: "<svg/>", width: 10, height: 10 } };
const molecule: DrawingSource = { kind: "molecule", source: { settings: { ...DEFAULT_MOLECULE_LOOK, smiles: "CC(=O)Oc1ccccc1C(=O)O" }, svg: "<svg><text>O</text></svg>", width: 10, height: 10 } };
const titledChart: DrawingSource = { kind: "chart", source: { settings: { ...chartSettings, title: " Drinks " }, svg: "<svg/>", width: 10, height: 10 } };

function imageWith(drawing?: DrawingSource): EditorPending {
  return { id: "i", kind: "image", pageIndex: 1, x: 1, y: 2, width: 3, height: 4, dataUrl: "", path: null, aspect: 1, opacity: 1, ...(drawing ? { drawing } : {}) };
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

describe("drawing kinds", () => {
  it("lists every kind once, in menu order, with its texts in each language", () => {
    expect(DRAWING_KINDS).toEqual(["formula", "shape", "graph", "molecule", "table", "chart", "flowchart", "question", "answerKey"]);
    for (const kind of DRAWING_KINDS) {
      for (const key of Object.values(DRAWING_SPECS[kind].labels)) {
        expect(typeof lookup(en, key), `${kind} ${key}`).toBe("string");
        expect(typeof lookup(tr, key), `${kind} ${key}`).toBe("string");
      }
    }
  });

  it("tells drawings apart from pictures and from each other", () => {
    expect(isDrawingImage(imageWith())).toBe(false);
    expect(isDrawingImage(imageWith(shape))).toBe(true);
    expect(isDrawingKind(imageWith(shape), "shape")).toBe(true);
    expect(isDrawingKind(imageWith(shape), "formula")).toBe(false);
    expect(isDrawingImage(null)).toBe(false);
  });

  it("sends each kind's own SVG, painting a formula in its colour", () => {
    const formulaItem = imageWith(formula);
    const graphItem = imageWith(graph);
    if (!isDrawingImage(formulaItem) || !isDrawingImage(graphItem)) throw new Error("not drawings");
    const formulaObject = toDrawingObject(formulaItem);
    expect(formulaObject.kind === "drawing" ? formulaObject.svg : "").toContain('fill="#123456"');
    expect(toDrawingObject(graphItem)).toEqual({ id: "i", kind: "drawing", page: 2, x0: 1, y0: 2, x1: 4, y1: 6, svg: "<svg/>", opacity: 1 });
    const moleculeItem = imageWith(molecule);
    if (!isDrawingImage(moleculeItem)) throw new Error("not a drawing");
    expect(toDrawingObject(moleculeItem)).toMatchObject({ kind: "drawing", svg: "<svg><text>O</text></svg>" });
  });

  it("names each kind in the layers list", () => {
    const t = i18n.t.bind(i18n);
    expect(drawingLayerLabel(formula, t)).toBe("Formula: a^2 + b^2");
    expect(drawingLayerLabel(shape, t)).toBe(`Shape: ${en.viewer.shapes.names.cone}`);
    expect(drawingLayerLabel(graph, t)).toBe("Graph: x^2; sin x");
    expect(drawingLayerLabel(table, t)).toBe("Table 2×3: Name");
    expect(drawingLayerLabel(chart, t)).toBe("Chart: Pie");
    expect(drawingLayerLabel(titledChart, t)).toBe("Chart: Drinks");
    expect(drawingLayerLabel(question, t)).toBe("Question 7: Which city is the capital?");
    expect(drawingLayerLabel(unnumbered, t)).toBe("Question: Which city is the capital?");
    expect(drawingLayerLabel(answerKey, t)).toBe("Answer key (3)");
    expect(drawingLayerLabel(flowchart, t)).toBe("Flowchart: Begin here");
    expect(drawingLayerLabel(molecule, t)).toBe("Molecule: CC(=O)Oc1ccccc1C(=O)O");
  });

  it("describes each kind in words for screen readers, without giving away a question's answer", () => {
    const t = i18n.t.bind(i18n);
    expect(drawingAltText(formula, t)).toBe("Formula: a^2 + b^2");
    expect(drawingAltText(graph, t)).toBe(`Graph of f(x) = x^2; h(x) = sin x, x from ${DEFAULT_GRAPH.xMin} to ${DEFAULT_GRAPH.xMax}`);
    expect(drawingAltText(molecule, t)).toBe("Chemical structure, SMILES CC(=O)Oc1ccccc1C(=O)O");
    expect(drawingAltText(table, t)).toBe("Table with 2 rows and 3 columns: Name, Age; Ada, 36");
    expect(drawingAltText(titledChart, t)).toBe("Pie chart “Drinks”: Tea: Share 3; Coffee: Share 1.5");
    expect(drawingAltText(question, t)).toBe("Question 7: Which city is the capital? Options: A) Paris; B) Ankara");
    expect(drawingAltText(answerKey, t)).toBe("Answer key: 1 A, 2 C, 3");
    expect(drawingAltText(flowchart, t)).toBe("Flowchart. Steps: 1. Begin here; 2. Work; 3. Stop. Arrows: Begin here → Work; Work → Stop");
    const long: DrawingSource = { kind: "formula", source: { ...formula.source, latex: "x+".repeat(MAX_ALT_CHARS) } };
    expect(drawingAltText(long, t)).toHaveLength(MAX_ALT_CHARS);
    const item = imageWith(shape);
    if (!isDrawingImage(item)) throw new Error("not a drawing");
    expect(toDrawingObject(item, drawingAltText(shape, t))).toMatchObject({ kind: "drawing", alt: `Drawing: ${en.viewer.shapes.names.cone}` });
    expect(toDrawingObject(item)).not.toHaveProperty("alt");
  });

  it("sends a chart as its data and look so its labels stay real text", () => {
    const chartItem = imageWith(chart);
    if (!isDrawingImage(chartItem)) throw new Error("not a drawing");
    expect(toDrawingObject(chartItem)).toMatchObject({
      id: "i",
      kind: "chart",
      type: "pie",
      page: 2,
      x0: 1,
      y1: 6,
      categories: ["Tea", "Coffee"],
      series: [{ name: "Share", color: CHART_PALETTES.vivid[0], values: [3, 1.5] }],
      palette: [...CHART_PALETTES.vivid],
      stacked: false,
    });
  });

  it("sends a table as its cells and look, not as a picture, so its text stays searchable", () => {
    const tableItem = imageWith(table);
    if (!isDrawingImage(tableItem)) throw new Error("not a drawing");
    expect(toDrawingObject(tableItem)).toEqual({
      id: "i",
      kind: "table",
      page: 2,
      x0: 1,
      y0: 2,
      x1: 4,
      y1: 6,
      opacity: 1,
      cells: [["", " Name ", "Age"], ["Ada", "36", ""]],
      columnWidths: [3, 4, 3],
      align: ["left", "center", "right"],
      width: DEFAULT_TABLE.width,
      fontSize: DEFAULT_TABLE.fontSize,
      fontId: DEFAULT_TABLE.fontId,
      header: true,
      border: DEFAULT_TABLE.border,
      color: DEFAULT_TABLE.color,
      borderColor: DEFAULT_TABLE.borderColor,
      headerFill: DEFAULT_TABLE.headerFill,
      stripes: false,
    });
  });

  it("sends a question as its text and options, and only circles the answer when asked", () => {
    const questionItem = imageWith(question);
    if (!isDrawingImage(questionItem)) throw new Error("not a drawing");
    expect(toDrawingObject(questionItem)).toMatchObject({ kind: "question", page: 2, number: 7, options: ["Paris", "Ankara"], answer: 1, markAnswer: false, answerLines: 0 });
  });

  it("sends an answer key as a table split into column pairs", () => {
    const keyItem = imageWith(answerKey);
    if (!isDrawingImage(keyItem)) throw new Error("not a drawing");
    expect(toDrawingObject(keyItem)).toMatchObject({
      kind: "table",
      cells: [["No", "Key", "No", "Key"], ["1", "A", "3", ""], ["2", "C", "", ""]],
      columnWidths: [1, 1, 1, 1],
      header: true,
    });
  });

  it("sends a flowchart as its steps and arrows so the engine lays it out with real text", () => {
    const flowItem = imageWith(flowchart);
    if (!isDrawingImage(flowItem)) throw new Error("not a drawing");
    expect(toDrawingObject(flowItem)).toMatchObject({
      kind: "flowchart",
      page: 2,
      direction: "down",
      nodes: [{ id: "n1", shape: "terminal" }, { id: "n2", shape: "process", text: "Work" }, { id: "n3", shape: "terminal", text: "Stop" }],
      edges: [{ source: "n1", target: "n2", label: "" }, { source: "n2", target: "n3", label: "" }],
    });
  });
});
