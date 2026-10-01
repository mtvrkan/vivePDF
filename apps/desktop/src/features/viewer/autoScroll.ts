export type ScrollAxis = { position: number; size: number; viewport: number };

export function scrollDistance(pixelsPerSecond: number, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return (pixelsPerSecond * Math.min(elapsedMs, 250)) / 1000;
}

export function reachedEnd(axis: ScrollAxis, backwards: boolean): boolean {
  if (backwards) return axis.position <= 0;
  return axis.position + axis.viewport >= axis.size - 1;
}

export function splitWhole(distance: number): { whole: number; rest: number } {
  const whole = Math.trunc(distance);
  return { whole, rest: distance - whole };
}

export function isAutoScrollToggle(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "key">): boolean {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "h";
}
