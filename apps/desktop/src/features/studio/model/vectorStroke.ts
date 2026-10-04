import type { StudioVectorElement } from "@/types/studio";

export const MIN_VECTOR_STROKE = 0.1;
export const MAX_VECTOR_STROKE = 500;

function viewScale(element: StudioVectorElement): number {
  return Math.sqrt((element.width / element.viewWidth) * (element.height / element.viewHeight)) || 1;
}

function widest(element: StudioVectorElement): number | null {
  const widths = element.paths.flatMap((path) => (path.stroke ? [path.stroke.width] : []));
  return widths.length ? Math.max(...widths) * viewScale(element) : null;
}

export function vectorStrokeWidth(element: StudioVectorElement): number | null {
  const width = widest(element);
  return width === null ? null : Math.round(width * 100) / 100;
}

export function withVectorStrokeWidth(element: StudioVectorElement, width: number): StudioVectorElement {
  const current = widest(element);
  if (current === null || !(width > 0) || Math.abs(current - width) < 1e-6) return element;
  const factor = width / current;
  return {
    ...element,
    paths: element.paths.map((path) => (path.stroke ? { ...path, stroke: { ...path.stroke, width: Math.min(MAX_VECTOR_STROKE, Math.max(MIN_VECTOR_STROKE, path.stroke.width * factor)) } } : path)),
  };
}
