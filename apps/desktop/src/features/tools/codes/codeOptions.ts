import type { CodeFormat } from "@/types";

export const MM_TO_PT = 72 / 25.4;
export const SIZE_MM = { min: 9, max: 140 } as const;
export const HEIGHT_MM = { min: 5, max: 140 } as const;
export const MARGIN_MM = { min: 0, max: 70 } as const;

export type ErrorLevel = "L" | "M" | "Q" | "H";

const QR_LEVELS: ErrorLevel[] = ["L", "M", "Q", "H"];
const MICRO_QR_LEVELS: ErrorLevel[] = ["L", "M", "Q"];

export function levelsFor(format: CodeFormat): ErrorLevel[] {
  if (format === "qr") return QR_LEVELS;
  if (format === "microQr") return MICRO_QR_LEVELS;
  return [];
}

export function levelFor(format: CodeFormat, level: ErrorLevel): ErrorLevel {
  const levels = levelsFor(format);
  if (levels.length === 0 || levels.includes(level)) return level;
  return levels[levels.length - 1] ?? level;
}
