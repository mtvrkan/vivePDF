export type BoxRect = { origin: { x: number; y: number }; size: { width: number; height: number } };
export type SelectionBox = { x: number; y: number; right: number; bottom: number };

export function selectionBoxOf(items: BoxRect[]): SelectionBox | null {
  if (items.length === 0) return null;
  return items.reduce<SelectionBox>(
    (box, item) => ({
      x: Math.min(box.x, item.origin.x),
      y: Math.min(box.y, item.origin.y),
      right: Math.max(box.right, item.origin.x + item.size.width),
      bottom: Math.max(box.bottom, item.origin.y + item.size.height),
    }),
    { x: items[0].origin.x, y: items[0].origin.y, right: items[0].origin.x + items[0].size.width, bottom: items[0].origin.y + items[0].size.height },
  );
}
