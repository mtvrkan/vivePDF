export const MM_PER_POINT = 25.4 / 72;

export function toMm(points: number): number {
  return Math.round(points * MM_PER_POINT * 10) / 10;
}

export function fromMm(millimetres: number): number {
  return millimetres / MM_PER_POINT;
}
