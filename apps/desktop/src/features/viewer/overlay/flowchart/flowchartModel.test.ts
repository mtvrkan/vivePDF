import { describe, expect, it } from "vitest";
import { DEFAULT_FLOW_LOOK, FLOW_LIMITS, addArrow, addStep, freshId, isBlankFlowchart, newFlowchart, removeStep, toFlowchartSpec, updateArrow, updateStep, validArrows } from "./flowchartModel";

const texts = { start: "Start", step: "Step", end: "End" };

describe("flowchart settings", () => {
  it("starts as start, one step and end joined in order", () => {
    const chart = newFlowchart(DEFAULT_FLOW_LOOK, texts);
    expect(chart.nodes.map((node) => [node.shape, node.text])).toEqual([
      ["terminal", "Start"],
      ["process", "Step"],
      ["terminal", "End"],
    ]);
    expect(chart.edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual(["n1>n2", "n2>n3"]);
  });

  it("joins a new step to the last one with a fresh id", () => {
    const chart = addStep(newFlowchart(DEFAULT_FLOW_LOOK, texts));
    expect(chart.nodes.at(-1)).toEqual({ id: "n4", shape: "process", text: "" });
    expect(chart.edges.at(-1)).toMatchObject({ source: "n3", target: "n4" });
    expect(freshId([{ id: "n2", shape: "process", text: "" }])).toBe("n3");
  });

  it("drops the arrows of a removed step and keeps at least one step", () => {
    const chart = removeStep(newFlowchart(DEFAULT_FLOW_LOOK, texts), "n2");
    expect(chart.nodes.map((node) => node.id)).toEqual(["n1", "n3"]);
    expect(chart.edges).toEqual([]);
    const single = { ...chart, nodes: [chart.nodes[0]] };
    expect(removeStep(single, "n1")).toBe(single);
  });

  it("stops adding steps at the limit", () => {
    const full = { ...newFlowchart(DEFAULT_FLOW_LOOK, texts), nodes: Array.from({ length: FLOW_LIMITS.nodes }, (_, index) => ({ id: `n${index + 1}`, shape: "process" as const, text: "x" })) };
    expect(addStep(full)).toBe(full);
  });

  it("sends only arrows that join two different existing steps, once each", () => {
    let chart = newFlowchart(DEFAULT_FLOW_LOOK, texts);
    chart = addArrow(chart);
    chart = updateArrow(chart, 2, { source: "n3", target: "n3" });
    chart = { ...chart, edges: [...chart.edges, { source: "n1", target: "n2", label: "again" }, { source: "n9", target: "n1", label: "" }] };
    expect(validArrows(chart).map((edge) => `${edge.source}>${edge.target}`)).toEqual(["n1>n2", "n2>n3"]);
    expect(toFlowchartSpec(chart).edges).toHaveLength(2);
  });

  it("is blank until a step has text", () => {
    const chart = newFlowchart(DEFAULT_FLOW_LOOK, texts);
    const cleared = chart.nodes.reduce((current, node) => updateStep(current, node.id, { text: "  " }), chart);
    expect(isBlankFlowchart(cleared)).toBe(true);
    expect(isBlankFlowchart(updateStep(cleared, "n2", { text: "Read n" }))).toBe(false);
  });
});
