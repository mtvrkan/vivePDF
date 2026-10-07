import { PdfAnnotationSubtype, type PdfLineAnnoObject, type PdfPolylineAnnoObject, type Position, type Rect } from "@embedpdf/models";

export const CURVE_SEGMENTS = 12;
export const MIN_CURVE = -100;
export const MAX_CURVE = 100;
export const CURVE_STEP = 5;

export function curveControlPoint(start: Position, end: Position, curve: number): Position {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: midX, y: midY };
  const offset = (curve / 100) * length;
  return { x: midX - (dy / length) * offset, y: midY + (dx / length) * offset };
}

export function curvedVertices(start: Position, end: Position, curve: number, segments: number = CURVE_SEGMENTS): Position[] {
  if (curve === 0) return [start, end];
  const control = curveControlPoint(start, end, curve);
  const vertices: Position[] = [];
  for (let step = 0; step <= segments; step += 1) {
    const t = step / segments;
    const inverse = 1 - t;
    vertices.push({
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
    });
  }
  return vertices;
}

export function curveFromVertices(vertices: Position[]): number {
  if (vertices.length < 3) return 0;
  const start = vertices[0];
  const end = vertices[vertices.length - 1];
  const middle = vertices[Math.round((vertices.length - 1) / 2)];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const offset = ((middle.x - midX) * (-dy / length) + (middle.y - midY) * (dx / length)) * 2;
  return Math.round((offset / length) * 100);
}

export function boundsOf(points: Position[], padding = 0): Rect {
  const first = points[0] ?? { x: 0, y: 0 };
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    origin: { x: minX - padding, y: minY - padding },
    size: { width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 },
  };
}

export function lineEndpoints(object: PdfLineAnnoObject | PdfPolylineAnnoObject): { start: Position; end: Position } {
  if (object.type === PdfAnnotationSubtype.POLYLINE) {
    const vertices = object.vertices;
    return { start: vertices[0] ?? { x: 0, y: 0 }, end: vertices[vertices.length - 1] ?? { x: 0, y: 0 } };
  }
  return object.linePoints;
}

export function isCurvable(object: PdfLineAnnoObject | PdfPolylineAnnoObject): boolean {
  if (object.type !== PdfAnnotationSubtype.POLYLINE) return true;
  return object.vertices.length === 2 || object.vertices.length === CURVE_SEGMENTS + 1;
}

export function currentCurve(object: PdfLineAnnoObject | PdfPolylineAnnoObject): number {
  return object.type === PdfAnnotationSubtype.POLYLINE ? curveFromVertices(object.vertices) : 0;
}

export function curveRectPatch(vertices: Position[], strokeWidth: number | undefined) {
  const rect = boundsOf(vertices, (strokeWidth ?? 1) / 2 + 1);
  return { rect, unrotatedRect: rect, rotation: 0 };
}

export function polylineFromLine(line: PdfLineAnnoObject, vertices: Position[], id: string): PdfPolylineAnnoObject {
  const { linePoints, ...rest } = line;
  void linePoints;
  return {
    ...rest,
    id,
    type: PdfAnnotationSubtype.POLYLINE,
    vertices,
    ...curveRectPatch(vertices, rest.strokeWidth),
  };
}
