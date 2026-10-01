export type ToolbarRect = { top: number; left: number; width: number; height: number };
export type ToolbarSize = { width: number; height: number };
export type ToolbarPlacement = { top: number; left: number; flipped: boolean };

export function computeToolbarPlacement(selectionRect: ToolbarRect, toolbarSize: ToolbarSize, viewportSize: ToolbarSize, gap = 6): ToolbarPlacement {
  const centeredLeft = selectionRect.left + selectionRect.width / 2 - toolbarSize.width / 2;
  const maxLeft = Math.max(0, viewportSize.width - toolbarSize.width);
  const left = Math.min(Math.max(centeredLeft, 0), maxLeft);
  const aboveTop = selectionRect.top - toolbarSize.height - gap;
  const flipped = aboveTop < 0;
  const top = flipped ? selectionRect.top + selectionRect.height + gap : aboveTop;
  return { top, left, flipped };
}
