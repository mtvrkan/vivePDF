export const TOOLTIP_GAP = 8;
const EDGE = 6;
const SIDE_ZONE = 96;

type Side = "bottom" | "top" | "right" | "left";
export type TooltipPosition = { top: number; left: number; side: Side };

export function tooltipPosition(rect: DOMRect, width: number, height: number): TooltipPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;
  let side: Side = rect.bottom + TOOLTIP_GAP + height > viewportHeight ? "top" : "bottom";
  if (rect.left < SIDE_ZONE && rect.right + TOOLTIP_GAP + width <= viewportWidth) side = "right";
  else if (rect.right > viewportWidth - SIDE_ZONE && rect.left - TOOLTIP_GAP - width >= 0) side = "left";
  let top: number;
  let left: number;
  if (side === "right" || side === "left") {
    top = centreY - height / 2;
    left = side === "right" ? rect.right + TOOLTIP_GAP : rect.left - TOOLTIP_GAP - width;
  } else {
    top = side === "bottom" ? rect.bottom + TOOLTIP_GAP : rect.top - TOOLTIP_GAP - height;
    left = centreX - width / 2;
  }
  left = Math.min(Math.max(left, EDGE), viewportWidth - width - EDGE);
  top = Math.min(Math.max(top, EDGE), viewportHeight - height - EDGE);
  return { top, left, side };
}
