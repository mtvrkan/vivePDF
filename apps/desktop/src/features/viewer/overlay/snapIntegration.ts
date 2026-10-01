import { snapValue } from "./snap";

export type SnapRect = { x: number; y: number; width: number; height: number };
export type SnappedRect = { x: number; y: number; guides: { x: number[]; y: number[] } };

type AxisCandidate = { position: number; guide: number; distance: number };

function bestAxisSnap(edges: Array<{ edge: number; toPosition: (snapped: number) => number }>, candidates: number[], tolerance: number): AxisCandidate | null {
  const resolved: AxisCandidate[] = [];
  for (const { edge, toPosition } of edges) {
    const snapped = snapValue(edge, candidates, tolerance, 1);
    if (snapped.guide === null) continue;
    resolved.push({ position: toPosition(snapped.value), guide: snapped.guide, distance: Math.abs(snapped.value - edge) });
  }
  if (resolved.length === 0) return null;
  return resolved.reduce((closest, candidate) => (candidate.distance < closest.distance ? candidate : closest));
}

export function computeSnappedRect(rect: SnapRect, candidatesX: number[], candidatesY: number[], toleranceX: number, toleranceY: number): SnappedRect {
  const bestX = bestAxisSnap(
    [
      { edge: rect.x, toPosition: (snapped) => snapped },
      { edge: rect.x + rect.width / 2, toPosition: (snapped) => snapped - rect.width / 2 },
      { edge: rect.x + rect.width, toPosition: (snapped) => snapped - rect.width },
    ],
    candidatesX,
    toleranceX,
  );
  const bestY = bestAxisSnap(
    [
      { edge: rect.y, toPosition: (snapped) => snapped },
      { edge: rect.y + rect.height / 2, toPosition: (snapped) => snapped - rect.height / 2 },
      { edge: rect.y + rect.height, toPosition: (snapped) => snapped - rect.height },
    ],
    candidatesY,
    toleranceY,
  );
  return {
    x: bestX ? bestX.position : rect.x,
    y: bestY ? bestY.position : rect.y,
    guides: { x: bestX ? [bestX.guide] : [], y: bestY ? [bestY.guide] : [] },
  };
}
