export type LineRect = { x: number; width: number };

export function reindentLines(lines: string[], rects: (LineRect | null | undefined)[]): string[] {
  const validRects = rects.filter((rect): rect is LineRect => Boolean(rect) && Number.isFinite(rect?.x));
  if (validRects.length === 0) return lines.map((line) => line.trimStart());
  const leftMost = Math.min(...validRects.map((rect) => rect.x));
  return lines.map((line, index) => {
    const trimmed = line.trimStart();
    const rect = rects[index];
    if (!rect || !Number.isFinite(rect.x) || trimmed.length === 0) return trimmed;
    const charWidth = rect.width > 0 && trimmed.length > 0 ? rect.width / trimmed.length : 0;
    if (charWidth <= 0) return trimmed;
    const offset = Math.max(0, rect.x - leftMost);
    const indent = Math.round(offset / charWidth);
    return " ".repeat(indent) + trimmed;
  });
}
