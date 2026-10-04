export const MM_PER_POINT = 25.4 / 72;

export function toMm(points: number): number {
  return Math.round(points * MM_PER_POINT * 10) / 10;
}

export function fromMm(millimetres: number): number {
  return millimetres / MM_PER_POINT;
}

export function formatMm(points: number, language: string): string {
  const millimetres = points * MM_PER_POINT;
  return new Intl.NumberFormat(language, { maximumFractionDigits: Math.abs(millimetres) >= 100 ? 0 : 1 }).format(millimetres);
}
