export type QuarterTurns = 0 | 1 | 2 | 3;

type ScreenRect = { left: number; top: number; width: number; height: number };
type FrameBox = { x: number; y: number; width: number; height: number };

export function quarterTurns(value: number, unit: "degrees" | "quarters" = "degrees"): QuarterTurns {
  const quarters = unit === "degrees" ? Math.round(value / 90) : Math.round(value);
  return (((quarters % 4) + 4) % 4) as QuarterTurns;
}

export function frameSizePx(turns: QuarterTurns, widthPx: number, heightPx: number): { width: number; height: number } {
  return turns % 2 === 1 ? { width: heightPx, height: widthPx } : { width: widthPx, height: heightPx };
}

export function frameTransform(turns: QuarterTurns, widthPx: number, heightPx: number): string | undefined {
  if (turns === 1) return `matrix(0, -1, 1, 0, 0, ${heightPx})`;
  if (turns === 2) return `matrix(-1, 0, 0, -1, ${widthPx}, ${heightPx})`;
  if (turns === 3) return `matrix(0, 1, -1, 0, ${widthPx}, 0)`;
  return undefined;
}

export function frameToLocal(turns: QuarterTurns, widthPx: number, heightPx: number, x: number, y: number): { x: number; y: number } {
  if (turns === 1) return { x: y, y: heightPx - x };
  if (turns === 2) return { x: widthPx - x, y: heightPx - y };
  if (turns === 3) return { x: widthPx - y, y: x };
  return { x, y };
}

export function screenToFrame(clientX: number, clientY: number, rect: ScreenRect, viewTurns: QuarterTurns): { x: number; y: number } {
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  if (viewTurns === 1) return { x: sy, y: rect.width - sx };
  if (viewTurns === 2) return { x: rect.width - sx, y: rect.height - sy };
  if (viewTurns === 3) return { x: rect.height - sy, y: sx };
  return { x: sx, y: sy };
}

export function frameToScreen(box: FrameBox, rect: ScreenRect, viewTurns: QuarterTurns): ScreenRect {
  if (viewTurns === 1) return { left: rect.left + rect.width - (box.y + box.height), top: rect.top + box.x, width: box.height, height: box.width };
  if (viewTurns === 2) return { left: rect.left + rect.width - (box.x + box.width), top: rect.top + rect.height - (box.y + box.height), width: box.width, height: box.height };
  if (viewTurns === 3) return { left: rect.left + box.y, top: rect.top + rect.height - (box.x + box.width), width: box.height, height: box.width };
  return { left: rect.left + box.x, top: rect.top + box.y, width: box.width, height: box.height };
}

export function transformTurns(transform: string): QuarterTurns {
  const values = /^matrix\(([^)]+)\)$/.exec(transform.trim())?.[1].split(",").map(Number);
  if (!values || values.length < 2 || values.some(Number.isNaN)) return 0;
  return quarterTurns((Math.atan2(values[1], values[0]) * 180) / Math.PI);
}

export function viewTurnsOf(layer: HTMLElement | null): QuarterTurns {
  const rotator = layer?.closest("[data-page-index]")?.parentElement;
  if (!layer || !rotator) return 0;
  return quarterTurns(transformTurns(getComputedStyle(rotator).transform) + transformTurns(getComputedStyle(layer).transform), "quarters");
}
