import * as diagrams from "./diagrams";
import * as physics from "./physics";
import * as plane from "./plane";
import type { Primitive } from "./primitives";
import * as solids from "./solids";

export type ShapeGroup = "geometry" | "solids" | "diagrams" | "physics" | "circuits";
export type ShapeParamSpec =
  | { key: string; kind: "range"; min: number; max: number; step: number; initial: number; unit?: "°" }
  | { key: string; kind: "toggle"; initial: boolean };
export type ShapeParams = Record<string, number | boolean>;
export type ShapeDefinition = { id: string; group: ShapeGroup; params: ShapeParamSpec[]; build: (params: ShapeParams) => Primitive[] };

export const SHAPE_GROUPS: ShapeGroup[] = ["geometry", "solids", "diagrams", "physics", "circuits"];

const VIEW_PARAMS: ShapeParamSpec[] = [
  { key: "yaw", kind: "range", min: -180, max: 180, step: 1, initial: 32, unit: "°" },
  { key: "pitch", kind: "range", min: -90, max: 90, step: 1, initial: 20, unit: "°" },
  { key: "hidden", kind: "toggle", initial: true },
];

function num(params: ShapeParams, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function flag(params: ShapeParams, key: string, fallback: boolean): boolean {
  const value = params[key];
  return typeof value === "boolean" ? value : fallback;
}

function view(params: ShapeParams): solids.View {
  return { yaw: num(params, "yaw", 32), pitch: num(params, "pitch", 20), hidden: flag(params, "hidden", true) };
}

function range(key: string, min: number, max: number, initial: number, step = 1, unit?: "°"): ShapeParamSpec {
  return { key, kind: "range", min, max, step, initial, unit };
}

export const SHAPES: ShapeDefinition[] = [
  { id: "triangle", group: "geometry", params: [], build: () => plane.triangle() },
  { id: "rightTriangle", group: "geometry", params: [], build: () => plane.rightTriangle() },
  { id: "square", group: "geometry", params: [range("size", 40, 200, 110)], build: (params) => plane.square(num(params, "size", 110)) },
  { id: "rectangle", group: "geometry", params: [range("width", 40, 240, 160), range("height", 30, 200, 95)], build: (params) => plane.rectangle(num(params, "width", 160), num(params, "height", 95)) },
  { id: "parallelogram", group: "geometry", params: [], build: () => plane.parallelogram() },
  { id: "trapezoid", group: "geometry", params: [], build: () => plane.trapezoid() },
  { id: "polygon", group: "geometry", params: [range("sides", 3, 12, 6), range("radius", 30, 120, 70)], build: (params) => plane.regularPolygon(num(params, "sides", 6), num(params, "radius", 70)) },
  { id: "circle", group: "geometry", params: [range("radius", 20, 120, 65)], build: (params) => plane.circle(num(params, "radius", 65)) },
  { id: "angle", group: "geometry", params: [range("angle", 5, 175, 50, 1, "°")], build: (params) => plane.angle(num(params, "angle", 50)) },
  { id: "parallelLines", group: "geometry", params: [], build: () => plane.parallelLines() },
  { id: "axes", group: "geometry", params: [range("range", 1, 10, 5), { key: "grid", kind: "toggle", initial: false }], build: (params) => plane.axes(num(params, "range", 5), flag(params, "grid", false)) },
  { id: "numberLine", group: "geometry", params: [range("range", 1, 10, 5)], build: (params) => plane.numberLine(num(params, "range", 5)) },
  { id: "vector", group: "geometry", params: [range("length", 30, 200, 120), range("angle", -180, 180, 30, 1, "°")], build: (params) => plane.vector(num(params, "length", 120), num(params, "angle", 30)) },
  { id: "cube", group: "solids", params: [range("size", 40, 160, 100), ...VIEW_PARAMS], build: (params) => solids.polyhedron(solids.box(num(params, "size", 100), num(params, "size", 100), num(params, "size", 100)), view(params), solids.polyhedronLabels("cube")) },
  { id: "box", group: "solids", params: [range("width", 30, 200, 140), range("height", 30, 200, 80), range("depth", 30, 200, 90), ...VIEW_PARAMS], build: (params) => solids.polyhedron(solids.box(num(params, "width", 140), num(params, "height", 80), num(params, "depth", 90)), view(params), solids.polyhedronLabels("box")) },
  { id: "prism", group: "solids", params: [range("width", 30, 200, 110), range("height", 30, 200, 90), range("depth", 30, 220, 150), ...VIEW_PARAMS], build: (params) => solids.polyhedron(solids.triangularPrism(num(params, "width", 110), num(params, "height", 90), num(params, "depth", 150)), view(params), solids.polyhedronLabels("prism")) },
  { id: "pyramid", group: "solids", params: [range("width", 40, 200, 120), range("height", 40, 200, 120), ...VIEW_PARAMS], build: (params) => [...solids.polyhedron(solids.squarePyramid(num(params, "width", 120), num(params, "height", 120)), view(params), [{ axis: "x", latex: "a" }]), ...solids.pyramidHeight(num(params, "height", 120), view(params))] },
  { id: "tetrahedron", group: "solids", params: [range("size", 60, 200, 130), ...VIEW_PARAMS], build: (params) => solids.polyhedron(solids.tetrahedron(num(params, "size", 130)), view(params)) },
  { id: "cylinder", group: "solids", params: [range("radius", 20, 100, 50), range("height", 30, 220, 120), ...VIEW_PARAMS], build: (params) => solids.cylinder(num(params, "radius", 50), num(params, "height", 120), view(params)) },
  { id: "cone", group: "solids", params: [range("radius", 20, 100, 55), range("height", 30, 220, 130), ...VIEW_PARAMS], build: (params) => solids.cone(num(params, "radius", 55), num(params, "height", 130), view(params)) },
  { id: "sphere", group: "solids", params: [range("radius", 30, 120, 70), ...VIEW_PARAMS], build: (params) => solids.sphere(num(params, "radius", 70), view(params)) },
  { id: "venn2", group: "diagrams", params: [{ key: "universe", kind: "toggle", initial: true }], build: (params) => diagrams.venn2(flag(params, "universe", true)) },
  { id: "venn3", group: "diagrams", params: [{ key: "universe", kind: "toggle", initial: true }], build: (params) => diagrams.venn3(flag(params, "universe", true)) },
  { id: "probabilityTree", group: "diagrams", params: [range("levels", 1, 3, 2), range("branches", 2, 3, 2)], build: (params) => diagrams.probabilityTree(num(params, "levels", 2), num(params, "branches", 2)) },
  { id: "fractionCircle", group: "diagrams", params: [range("numerator", 0, 16, 3), range("denominator", 2, 16, 8), { key: "showFraction", kind: "toggle", initial: true }], build: (params) => diagrams.fractionCircle(num(params, "numerator", 3), num(params, "denominator", 8), flag(params, "showFraction", true)) },
  { id: "fractionBar", group: "diagrams", params: [range("numerator", 0, 16, 2), range("denominator", 2, 16, 5), { key: "showFraction", kind: "toggle", initial: true }], build: (params) => diagrams.fractionBar(num(params, "numerator", 2), num(params, "denominator", 5), flag(params, "showFraction", true)) },
  { id: "incline", group: "physics", params: [range("angle", 10, 60, 30, 1, "°"), { key: "forces", kind: "toggle", initial: true }], build: (params) => physics.incline(num(params, "angle", 30), flag(params, "forces", true)) },
  { id: "spring", group: "physics", params: [range("coils", 3, 16, 8)], build: (params) => physics.spring(num(params, "coils", 8)) },
  { id: "pendulum", group: "physics", params: [range("angle", 5, 70, 25, 1, "°")], build: (params) => physics.pendulum(num(params, "angle", 25)) },
  { id: "pulley", group: "physics", params: [], build: () => physics.pulley() },
  { id: "convexLens", group: "physics", params: [], build: () => physics.lens("convex") },
  { id: "concaveLens", group: "physics", params: [], build: () => physics.lens("concave") },
  { id: "circuit", group: "circuits", params: [], build: () => physics.simpleCircuit() },
  { id: "resistor", group: "circuits", params: [], build: () => physics.resistor() },
  { id: "cell", group: "circuits", params: [], build: () => physics.cell() },
  { id: "capacitor", group: "circuits", params: [], build: () => physics.capacitor() },
  { id: "lamp", group: "circuits", params: [], build: () => physics.lamp() },
  { id: "switch", group: "circuits", params: [], build: () => physics.switchOpen() },
  { id: "ammeter", group: "circuits", params: [], build: () => physics.meter("A") },
  { id: "voltmeter", group: "circuits", params: [], build: () => physics.meter("V") },
];

export function shapeById(id: string): ShapeDefinition | null {
  return SHAPES.find((shape) => shape.id === id) ?? null;
}

export function initialParams(shape: ShapeDefinition): ShapeParams {
  return Object.fromEntries(shape.params.map((param) => [param.key, param.initial]));
}

export function clampParams(shape: ShapeDefinition, params: ShapeParams): ShapeParams {
  return Object.fromEntries(
    shape.params.map((param) => {
      const value = params[param.key];
      if (param.kind === "toggle") return [param.key, typeof value === "boolean" ? value : param.initial];
      const numeric = typeof value === "number" && Number.isFinite(value) ? value : param.initial;
      return [param.key, Math.min(param.max, Math.max(param.min, numeric))];
    }),
  );
}

export function isRotatable(shape: ShapeDefinition): boolean {
  return shape.params.some((param) => param.key === "yaw");
}
