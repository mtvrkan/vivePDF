import type { MeasureUnit, PagePoint } from "@/shared/store/viewerOverlayStore";

const PT_TO_MM = 25.4 / 72;

export function measureDistance(a: PagePoint, b: PagePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y) * PT_TO_MM;
}

export function rectAreaMm2(widthPt: number, heightPt: number): number {
  return widthPt * PT_TO_MM * (heightPt * PT_TO_MM);
}

export function formatLength(millimetres: number, unit: MeasureUnit, locale: string): string {
  const value = unit === "mm" ? millimetres : unit === "cm" ? millimetres / 10 : millimetres / 1000;
  const digits = unit === "m" ? 3 : unit === "cm" ? 2 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${unit}`;
}

export function formatArea(mm2: number, unit: MeasureUnit, locale: string): string {
  const value = unit === "mm" ? mm2 : unit === "cm" ? mm2 / 100 : mm2 / 1_000_000;
  const digits = unit === "m" ? 4 : unit === "cm" ? 2 : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${unit}²`;
}
