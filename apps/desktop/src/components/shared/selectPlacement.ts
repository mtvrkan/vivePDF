export type PlacementRect = { left: number; top: number; bottom: number; width: number };
export type PlacementViewport = { width: number; height: number };
export type SelectPlacement = { left: number; top: number; width: number; above: boolean };

const LIST_MAX_HEIGHT = 288;
const LIST_GAP = 6;
const MIN_WIDTH = 160;
const EDGE = 8;
const RIGHT_ZONE_RATIO = 2 / 3;

export function computeSelectPlacement(rect: PlacementRect, viewport: PlacementViewport, optionCount: number): SelectPlacement {
  const estimatedHeight = Math.min(LIST_MAX_HEIGHT, optionCount * 36 + 8);
  const spaceBelow = viewport.height - rect.bottom - LIST_GAP;
  const above = spaceBelow < estimatedHeight && rect.top > spaceBelow;
  const width = Math.max(rect.width, MIN_WIDTH);
  const alignRight = rect.left + rect.width / 2 >= viewport.width * RIGHT_ZONE_RATIO;
  const rawLeft = alignRight ? rect.left + rect.width - width : rect.left;
  const maxLeft = Math.max(EDGE, viewport.width - width - EDGE);
  const left = Math.min(Math.max(rawLeft, EDGE), maxLeft);
  return {
    left,
    width,
    top: above ? rect.top - LIST_GAP : rect.bottom + LIST_GAP,
    above,
  };
}
