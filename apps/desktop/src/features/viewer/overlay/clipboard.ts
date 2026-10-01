export type ClipboardPoint = { x: number; y: number; width: number; height: number };

export function pastePosition(source: ClipboardPoint, sourcePageIndex: number, targetPageIndex: number, pageWidth: number, pageHeight: number): { x: number; y: number } {
  const offset = sourcePageIndex === targetPageIndex ? 12 : 0;
  return {
    x: Math.min(Math.max(0, pageWidth - source.width), source.x + offset),
    y: Math.min(Math.max(0, pageHeight - source.height), source.y + offset),
  };
}
