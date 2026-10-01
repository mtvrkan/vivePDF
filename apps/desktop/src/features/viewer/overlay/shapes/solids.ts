import { centroid, DEG, rightAngleMark, segmentLabel, type Point, type Primitive } from "./primitives";

export type Vec3 = { x: number; y: number; z: number };
export type View = { yaw: number; pitch: number; hidden: boolean };
type Polyhedron = { vertices: Vec3[]; faces: number[][] };
type EdgeLabel = { axis: "x" | "y" | "z"; latex: string };

const LIGHT = normalize({ x: -0.45, y: 0.6, z: 0.66 });
const RIM_STEPS = 144;

function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(a: Vec3): Vec3 {
  const size = Math.hypot(a.x, a.y, a.z);
  return size > 1e-12 ? { x: a.x / size, y: a.y / size, z: a.z / size } : { x: 0, y: 0, z: 0 };
}

function mean(points: Vec3[]): Vec3 {
  const total = points.reduce((sum, item) => ({ x: sum.x + item.x, y: sum.y + item.y, z: sum.z + item.z }), { x: 0, y: 0, z: 0 });
  return { x: total.x / points.length, y: total.y / points.length, z: total.z / points.length };
}

export function rotate(vector: Vec3, view: Pick<View, "yaw" | "pitch">): Vec3 {
  const yaw = view.yaw * DEG;
  const pitch = view.pitch * DEG;
  const x1 = vector.x * Math.cos(yaw) + vector.z * Math.sin(yaw);
  const z1 = -vector.x * Math.sin(yaw) + vector.z * Math.cos(yaw);
  const y2 = vector.y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = vector.y * Math.sin(pitch) + z1 * Math.cos(pitch);
  return { x: x1, y: y2, z: z2 };
}

export function project(vector: Vec3): Point {
  return { x: vector.x, y: -vector.y };
}

function shadeOf(normal: Vec3): number {
  return 0.72 + 0.28 * Math.max(0, dot(normal, LIGHT));
}

export function polyhedron(solid: Polyhedron, view: View, edgeLabels: EdgeLabel[] = []): Primitive[] {
  const center = mean(solid.vertices);
  const turned = solid.vertices.map((vertex) => rotate(vertex, view));
  const screen = turned.map(project);
  const facing = solid.faces.map((face) => {
    let normal = normalize(cross(sub3(solid.vertices[face[1]], solid.vertices[face[0]]), sub3(solid.vertices[face[2]], solid.vertices[face[0]])));
    if (dot(normal, sub3(mean(face.map((index) => solid.vertices[index])), center)) < 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
    const viewNormal = rotate(normal, view);
    return { visible: viewNormal.z > 1e-9, shade: shadeOf(viewNormal) };
  });
  const edges = new Map<string, { a: number; b: number; faces: number[] }>();
  solid.faces.forEach((face, faceIndex) => {
    face.forEach((vertex, position) => {
      const next = face[(position + 1) % face.length];
      const key = vertex < next ? `${vertex}-${next}` : `${next}-${vertex}`;
      const entry = edges.get(key) ?? { a: Math.min(vertex, next), b: Math.max(vertex, next), faces: [] };
      entry.faces.push(faceIndex);
      edges.set(key, entry);
    });
  });
  const primitives: Primitive[] = [];
  solid.faces.forEach((face, faceIndex) => {
    if (facing[faceIndex].visible) primitives.push({ type: "polyline", points: face.map((index) => screen[index]), closed: true, line: "none", fill: facing[faceIndex].shade });
  });
  const visibleEdges: Array<{ a: number; b: number }> = [];
  for (const edge of edges.values()) {
    const shown = edge.faces.some((faceIndex) => facing[faceIndex].visible);
    if (shown) visibleEdges.push(edge);
    else if (view.hidden) primitives.push({ type: "polyline", points: [screen[edge.a], screen[edge.b]], line: "dashed", weight: 0.75 });
  }
  for (const edge of visibleEdges) primitives.push({ type: "polyline", points: [screen[edge.a], screen[edge.b]] });
  const middle = centroid(screen);
  for (const label of edgeLabels) {
    const along = visibleEdges.filter((edge) => {
      const direction = normalize(sub3(solid.vertices[edge.b], solid.vertices[edge.a]));
      return Math.abs(direction[label.axis]) > 0.999;
    });
    const score = (edge: { a: number; b: number }) => {
      const mid = { x: (screen[edge.a].x + screen[edge.b].x) / 2, y: (screen[edge.a].y + screen[edge.b].y) / 2 };
      return label.axis === "y" ? mid.x : mid.y;
    };
    const best = along.sort((first, second) => score(second) - score(first))[0];
    if (best) primitives.push(segmentLabel(label.latex, screen[best.a], screen[best.b], middle, 10));
  }
  return primitives;
}

export function box(width: number, height: number, depth: number): Polyhedron {
  const [x, y, z] = [width / 2, height / 2, depth / 2];
  const vertices = [
    { x: -x, y: -y, z: -z }, { x: x, y: -y, z: -z }, { x: x, y: y, z: -z }, { x: -x, y: y, z: -z },
    { x: -x, y: -y, z: z }, { x: x, y: -y, z: z }, { x: x, y: y, z: z }, { x: -x, y: y, z: z },
  ];
  return { vertices, faces: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]] };
}

export function triangularPrism(width: number, height: number, depth: number): Polyhedron {
  const [x, y, z] = [width / 2, height / 2, depth / 2];
  const vertices = [
    { x: -x, y: -y, z: z }, { x: x, y: -y, z: z }, { x: 0, y: y, z: z },
    { x: -x, y: -y, z: -z }, { x: x, y: -y, z: -z }, { x: 0, y: y, z: -z },
  ];
  return { vertices, faces: [[0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]] };
}

export function squarePyramid(width: number, height: number): Polyhedron {
  const [x, y] = [width / 2, height / 2];
  const vertices = [{ x: -x, y: -y, z: -x }, { x: x, y: -y, z: -x }, { x: x, y: -y, z: x }, { x: -x, y: -y, z: x }, { x: 0, y: y, z: 0 }];
  return { vertices, faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] };
}

export function tetrahedron(edge: number): Polyhedron {
  const radius = edge / Math.sqrt(3);
  const height = edge * Math.sqrt(2 / 3);
  const base = [90, 210, 330].map((angle) => ({ x: radius * Math.cos(angle * DEG), y: -height / 3, z: radius * Math.sin(angle * DEG) }));
  return { vertices: [...base, { x: 0, y: (height * 2) / 3, z: 0 }], faces: [[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]] };
}

export function pyramidHeight(height: number, view: View): Primitive[] {
  const apex = project(rotate({ x: 0, y: height / 2, z: 0 }, view));
  const foot = project(rotate({ x: 0, y: -height / 2, z: 0 }, view));
  return [{ type: "polyline", points: [apex, foot], line: "dashed", weight: 0.75 }, { type: "dot", center: foot, radius: 1.4 }, segmentLabel("h", apex, foot, { x: foot.x + 40, y: foot.y }, 8)];
}

type Rim = { points: Point[]; visible: boolean[] };

function rim(y: number, radius: number, view: View, visibleAt: (angle: number) => boolean): Rim {
  const points: Point[] = [];
  const visible: boolean[] = [];
  for (let index = 0; index <= RIM_STEPS; index += 1) {
    const angle = (index / RIM_STEPS) * Math.PI * 2;
    points.push(project(rotate({ x: radius * Math.cos(angle), y, z: radius * Math.sin(angle) }, view)));
    visible.push(visibleAt(angle));
  }
  return { points, visible };
}

function rimPrimitives(line: Rim, hidden: boolean): Primitive[] {
  const result: Primitive[] = [];
  let start = 0;
  for (let index = 1; index <= line.points.length; index += 1) {
    if (index === line.points.length || line.visible[index] !== line.visible[start]) {
      const run = line.points.slice(start, Math.min(index + 1, line.points.length));
      if (line.visible[start]) result.push({ type: "polyline", points: run });
      else if (hidden) result.push({ type: "polyline", points: run, line: "dashed", weight: 0.75 });
      start = index;
    }
  }
  return result;
}

function silhouetteAngles(normalAt: (angle: number) => Vec3, view: View): number[] {
  const angles: number[] = [];
  let previous = rotate(normalAt(0), view).z;
  for (let index = 1; index <= RIM_STEPS * 2; index += 1) {
    const angle = (index / (RIM_STEPS * 2)) * Math.PI * 2;
    const current = rotate(normalAt(angle), view).z;
    if ((previous <= 0 && current > 0) || (previous > 0 && current <= 0)) {
      const before = angle - Math.PI / RIM_STEPS;
      angles.push(before + (Math.PI / RIM_STEPS) * (previous / (previous - current)));
    }
    previous = current;
  }
  return angles;
}

function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const item of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], item) <= 0) lower.pop();
    lower.push(item);
  }
  const upper: Point[] = [];
  for (const item of sorted.reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], item) <= 0) upper.pop();
    upper.push(item);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function faces(normal: Vec3, view: View): boolean {
  return rotate(normal, view).z > 1e-9;
}

export function cylinder(radius: number, height: number, view: View): Primitive[] {
  const side = (angle: number): Vec3 => ({ x: Math.cos(angle), y: 0, z: Math.sin(angle) });
  const topVisible = faces({ x: 0, y: 1, z: 0 }, view);
  const bottomVisible = faces({ x: 0, y: -1, z: 0 }, view);
  const top = rim(height / 2, radius, view, (angle) => topVisible || faces(side(angle), view));
  const bottom = rim(-height / 2, radius, view, (angle) => bottomVisible || faces(side(angle), view));
  const outline = hull([...top.points, ...bottom.points]);
  const result: Primitive[] = [{ type: "polyline", points: outline, closed: true, line: "none", fill: 0.85 }];
  if (topVisible) result.push({ type: "polyline", points: top.points, closed: true, line: "none", fill: 1 });
  if (bottomVisible) result.push({ type: "polyline", points: bottom.points, closed: true, line: "none", fill: 1 });
  result.push(...rimPrimitives(top, view.hidden), ...rimPrimitives(bottom, view.hidden));
  const silhouettes = silhouetteAngles(side, view).map((angle) => [project(rotate({ x: radius * Math.cos(angle), y: height / 2, z: radius * Math.sin(angle) }, view)), project(rotate({ x: radius * Math.cos(angle), y: -height / 2, z: radius * Math.sin(angle) }, view))]);
  for (const [upper, lower] of silhouettes) result.push({ type: "polyline", points: [upper, lower] });
  const centreTop = project(rotate({ x: 0, y: height / 2, z: 0 }, view));
  const rimPoint = project(rotate({ x: radius, y: height / 2, z: 0 }, view));
  result.push({ type: "polyline", points: [centreTop, rimPoint], line: topVisible ? "solid" : "dashed", weight: 0.75 }, { type: "dot", center: centreTop, radius: 1.4 });
  const middle = centroid(outline);
  result.push(segmentLabel("r", centreTop, rimPoint, { x: centreTop.x, y: centreTop.y + 40 }, 7));
  const right = silhouettes.sort((a, b) => b[0].x - a[0].x)[0];
  if (right) result.push(segmentLabel("h", right[0], right[1], middle, 9));
  return result;
}

export function cone(radius: number, height: number, view: View): Primitive[] {
  const side = (angle: number): Vec3 => normalize({ x: height * Math.cos(angle), y: radius, z: height * Math.sin(angle) });
  const baseVisible = faces({ x: 0, y: -1, z: 0 }, view);
  const base = rim(-height / 2, radius, view, (angle) => baseVisible || faces(side(angle), view));
  const apex = project(rotate({ x: 0, y: height / 2, z: 0 }, view));
  const outline = hull([...base.points, apex]);
  const result: Primitive[] = [{ type: "polyline", points: outline, closed: true, line: "none", fill: 0.85 }];
  if (baseVisible) result.push({ type: "polyline", points: base.points, closed: true, line: "none", fill: 1 });
  result.push(...rimPrimitives(base, view.hidden));
  for (const angle of silhouetteAngles(side, view)) result.push({ type: "polyline", points: [apex, project(rotate({ x: radius * Math.cos(angle), y: -height / 2, z: radius * Math.sin(angle) }, view))] });
  const foot = project(rotate({ x: 0, y: -height / 2, z: 0 }, view));
  const rimPoint = project(rotate({ x: radius, y: -height / 2, z: 0 }, view));
  const inside = baseVisible ? "solid" : "dashed";
  result.push({ type: "polyline", points: [apex, foot], line: "dashed", weight: 0.75 }, { type: "polyline", points: [foot, rimPoint], line: inside, weight: 0.75 }, { type: "dot", center: foot, radius: 1.4 });
  if (Math.abs(apex.x - foot.x) + Math.abs(apex.y - foot.y) > 10) result.push(rightAngleMark(foot, apex, rimPoint, 6));
  result.push(segmentLabel("h", apex, foot, rimPoint, 7), segmentLabel("r", foot, rimPoint, apex, 7));
  return result;
}

export function sphere(radius: number, view: View): Primitive[] {
  const centre = { x: 0, y: 0 };
  const equator: Rim = { points: [], visible: [] };
  for (let index = 0; index <= RIM_STEPS; index += 1) {
    const angle = (index / RIM_STEPS) * Math.PI * 2;
    const turned = rotate({ x: radius * Math.cos(angle), y: 0, z: radius * Math.sin(angle) }, view);
    equator.points.push(project(turned));
    equator.visible.push(turned.z >= -1e-9);
  }
  const rightmost = equator.points.reduce((best, item, index) => (equator.visible[index] && item.x > best.x ? item : best), { x: -Infinity, y: 0 });
  const result: Primitive[] = [{ type: "circle", center: centre, radius, fill: 0.9 }, ...rimPrimitives(equator, view.hidden), { type: "dot", center: centre, radius: 1.4 }];
  if (Number.isFinite(rightmost.x)) result.push({ type: "polyline", points: [centre, rightmost], weight: 0.75 }, segmentLabel("r", centre, rightmost, { x: 0, y: radius }, 7));
  result.push({ type: "label", latex: "O", at: { x: -8, y: 7 } });
  return result;
}

export function polyhedronLabels(kind: "cube" | "box" | "prism"): EdgeLabel[] {
  if (kind === "cube") return [{ axis: "x", latex: "a" }];
  if (kind === "box") return [{ axis: "x", latex: "a" }, { axis: "z", latex: "b" }, { axis: "y", latex: "c" }];
  return [{ axis: "x", latex: "a" }, { axis: "z", latex: "h" }];
}
