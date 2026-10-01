import type { FlowchartSpec, FlowDirection, FlowShape } from "@/types";

export const FLOW_SHAPES: readonly FlowShape[] = ["process", "terminal", "decision", "io", "connector"];
export const FLOW_DIRECTIONS: readonly FlowDirection[] = ["down", "right"];
export const FLOW_LIMITS = { nodes: 40, edges: 80, nodeChars: 300, labelChars: 60 } as const;
export const DEFAULT_FLOW_FONT = "bundled:dejavu-sans";

export type FlowStep = { id: string; shape: FlowShape; text: string };
export type FlowArrow = { source: string; target: string; label: string };

export type FlowchartSettings = {
  nodes: FlowStep[];
  edges: FlowArrow[];
  direction: FlowDirection;
  fontSize: number;
  fontId: string;
  color: string;
  stroke: string;
  fill: string | null;
};

export type FlowchartLook = Omit<FlowchartSettings, "nodes" | "edges">;

export const DEFAULT_FLOW_LOOK: FlowchartLook = {
  direction: "down",
  fontSize: 10,
  fontId: DEFAULT_FLOW_FONT,
  color: "#111111",
  stroke: "#1f2937",
  fill: "#eef2ff",
};

export function flowchartLook(settings: FlowchartSettings): FlowchartLook {
  const { direction, fontSize, fontId, color, stroke, fill } = settings;
  return { direction, fontSize, fontId, color, stroke, fill };
}

export function freshId(nodes: readonly FlowStep[]): string {
  const taken = new Set(nodes.map((node) => node.id));
  let number = nodes.length + 1;
  while (taken.has(`n${number}`)) number += 1;
  return `n${number}`;
}

export function newFlowchart(look: FlowchartLook, texts: { start: string; step: string; end: string }): FlowchartSettings {
  const nodes: FlowStep[] = [
    { id: "n1", shape: "terminal", text: texts.start },
    { id: "n2", shape: "process", text: texts.step },
    { id: "n3", shape: "terminal", text: texts.end },
  ];
  return { ...look, nodes, edges: [{ source: "n1", target: "n2", label: "" }, { source: "n2", target: "n3", label: "" }] };
}

export function addStep(settings: FlowchartSettings): FlowchartSettings {
  if (settings.nodes.length >= FLOW_LIMITS.nodes) return settings;
  const id = freshId(settings.nodes);
  const last = settings.nodes[settings.nodes.length - 1];
  const edges = last && settings.edges.length < FLOW_LIMITS.edges ? [...settings.edges, { source: last.id, target: id, label: "" }] : settings.edges;
  return { ...settings, nodes: [...settings.nodes, { id, shape: "process", text: "" }], edges };
}

export function removeStep(settings: FlowchartSettings, id: string): FlowchartSettings {
  if (settings.nodes.length <= 1) return settings;
  return { ...settings, nodes: settings.nodes.filter((node) => node.id !== id), edges: settings.edges.filter((edge) => edge.source !== id && edge.target !== id) };
}

export function updateStep(settings: FlowchartSettings, id: string, change: Partial<Omit<FlowStep, "id">>): FlowchartSettings {
  return { ...settings, nodes: settings.nodes.map((node) => (node.id === id ? { ...node, ...change, text: (change.text ?? node.text).slice(0, FLOW_LIMITS.nodeChars) } : node)) };
}

export function addArrow(settings: FlowchartSettings): FlowchartSettings {
  if (settings.edges.length >= FLOW_LIMITS.edges || settings.nodes.length < 2) return settings;
  const source = settings.nodes[settings.nodes.length - 2].id;
  const target = settings.nodes[settings.nodes.length - 1].id;
  return { ...settings, edges: [...settings.edges, { source, target, label: "" }] };
}

export function removeArrow(settings: FlowchartSettings, index: number): FlowchartSettings {
  return { ...settings, edges: settings.edges.filter((_, position) => position !== index) };
}

export function updateArrow(settings: FlowchartSettings, index: number, change: Partial<FlowArrow>): FlowchartSettings {
  return { ...settings, edges: settings.edges.map((edge, position) => (position === index ? { ...edge, ...change, label: (change.label ?? edge.label).slice(0, FLOW_LIMITS.labelChars) } : edge)) };
}

export function validArrows(settings: FlowchartSettings): FlowArrow[] {
  const ids = new Set(settings.nodes.map((node) => node.id));
  const seen = new Set<string>();
  return settings.edges.filter((edge) => {
    const key = `${edge.source}>${edge.target}`;
    if (edge.source === edge.target || !ids.has(edge.source) || !ids.has(edge.target) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isBlankFlowchart(settings: FlowchartSettings): boolean {
  return settings.nodes.every((node) => !node.text.trim());
}

export function toFlowchartSpec(settings: FlowchartSettings): FlowchartSpec {
  return {
    nodes: settings.nodes.map(({ id, shape, text }) => ({ id, shape, text })),
    edges: validArrows(settings).map(({ source, target, label }) => ({ source, target, label: label.trim() })),
    direction: settings.direction,
    fontSize: settings.fontSize,
    fontId: settings.fontId,
    color: settings.color,
    stroke: settings.stroke,
    fill: settings.fill,
  };
}
