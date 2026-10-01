export type SnapResult = { value: number; guide: number | null };

export function snapValue(value: number, candidates: number[], toleranceScreen: number, scale: number): SnapResult {
  const tolerancePage = scale > 0 ? toleranceScreen / scale : toleranceScreen;
  let best: { candidate: number; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= tolerancePage && (!best || distance < best.distance)) best = { candidate, distance };
  }
  return best ? { value: best.candidate, guide: best.candidate } : { value, guide: null };
}

export function pageMarginCandidates(pageWidth: number, pageHeight: number, margin = 36): number[] {
  return [0, margin, pageWidth / 2, pageWidth - margin, pageWidth, 0, margin, pageHeight / 2, pageHeight - margin, pageHeight];
}

export function rectEdgeCandidates(rects: Array<{ x: number; y: number; width: number; height: number }>, axis: "x" | "y"): number[] {
  const candidates: number[] = [];
  for (const rect of rects) {
    if (axis === "x") {
      candidates.push(rect.x, rect.x + rect.width / 2, rect.x + rect.width);
    } else {
      candidates.push(rect.y, rect.y + rect.height / 2, rect.y + rect.height);
    }
  }
  return candidates;
}
