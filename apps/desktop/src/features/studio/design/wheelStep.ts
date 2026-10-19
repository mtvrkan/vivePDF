const PIXELS_PER_NOTCH = 100;

export function wheelStep(deltaY: number, step: number): number {
  const notches = Math.max(-1, Math.min(1, deltaY / PIXELS_PER_NOTCH));
  return step ** -notches;
}
