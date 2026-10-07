export type SyncTarget = { pageNumber: number; fraction: number };

export function scrollPositionOf(pageNumber: number, pageY: number, pageHeight: number): number {
  const fraction = pageHeight > 0 && Number.isFinite(pageY) ? Math.min(1, Math.max(0, pageY / pageHeight)) : 0;
  return Math.max(0, pageNumber - 1) + Math.min(fraction, 0.9999);
}

export function pageOffsetBetween(fromPage: number, toPage: number): number {
  return Number.isFinite(fromPage) && Number.isFinite(toPage) ? Math.round(toPage - fromPage) : 0;
}

export function syncTargetOf(position: number, offset: number, targetPageCount: number): SyncTarget | null {
  if (targetPageCount < 1 || !Number.isFinite(position)) return null;
  const shifted = position + offset;
  if (shifted < 0) return { pageNumber: 1, fraction: 0 };
  if (shifted >= targetPageCount) return { pageNumber: targetPageCount, fraction: 0 };
  const index = Math.floor(shifted);
  return { pageNumber: index + 1, fraction: shifted - index };
}
