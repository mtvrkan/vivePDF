import { MM_PER_POINT } from "./units";

export type RulerTick = { offset: number; kind: "major" | "mid" | "minor"; value: number };

const STEPS_MM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
export const MIN_LABEL_GAP_PX = 48;
export const MIN_TICK_GAP_PX = 5;
const TICK_LIMIT = 4000;

export function pixelsPerMm(zoom: number): number {
  return zoom / MM_PER_POINT;
}

export function rulerSteps(zoom: number): { major: number; minor: number } {
  const scale = pixelsPerMm(zoom);
  const major = STEPS_MM.find((step) => step * scale >= MIN_LABEL_GAP_PX) ?? STEPS_MM[STEPS_MM.length - 1];
  const minor = [major / 10, major / 5, major / 2].find((step) => step * scale >= MIN_TICK_GAP_PX) ?? major;
  return { major, minor };
}

function isMultiple(value: number, step: number): boolean {
  return Math.abs(value / step - Math.round(value / step)) < 1e-6;
}

export function rulerTicks(origin: number, length: number, zoom: number): RulerTick[] {
  if (!(length > 0) || !(zoom > 0)) return [];
  const scale = pixelsPerMm(zoom);
  const { major, minor } = rulerSteps(zoom);
  const first = Math.ceil(-origin / scale / minor);
  const last = Math.floor((length - origin) / scale / minor);
  const ticks: RulerTick[] = [];
  for (let index = first; index <= last && ticks.length < TICK_LIMIT; index += 1) {
    const value = Math.round(index * minor * 1000) / 1000;
    const kind = isMultiple(value, major) ? "major" : isMultiple(value, major / 2) ? "mid" : "minor";
    ticks.push({ offset: origin + value * scale, kind, value });
  }
  return ticks;
}
