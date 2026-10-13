export type PaperSize = "a6" | "a5" | "a4" | "a3" | "a2" | "letter" | "legal" | "tabloid";
export type PaperChange = "shrink" | "enlarge" | "same";
export type PageSizePt = { width: number; height: number };

export const PAPER_SIZES_MM: Record<PaperSize, { width: number; height: number }> = {
  a6: { width: 105, height: 148 },
  a5: { width: 148, height: 210 },
  a4: { width: 210, height: 297 },
  a3: { width: 297, height: 420 },
  a2: { width: 420, height: 594 },
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
  tabloid: { width: 279.4, height: 431.8 },
};

export const QUICK_PAPER_SIZES: readonly PaperSize[] = ["a6", "a5", "a4", "a3", "a2", "letter"];
export const PAPER_SIZE_OPTIONS: readonly PaperSize[] = ["a6", "a5", "a4", "a3", "a2", "letter", "legal", "tabloid"];

const MM_PER_PT = 25.4 / 72;
const SAME_TOLERANCE = 0.02;

export function paperScale(source: PageSizePt, paper: PaperSize, autoRotate: boolean): number {
  const target = PAPER_SIZES_MM[paper];
  const width = source.width * MM_PER_PT;
  const height = source.height * MM_PER_PT;
  const turned = autoRotate && width > height !== target.width > target.height;
  const targetWidth = turned ? target.height : target.width;
  const targetHeight = turned ? target.width : target.height;
  return Math.min(targetWidth / width, targetHeight / height);
}

export function paperChange(scale: number): PaperChange {
  if (Math.abs(scale - 1) <= SAME_TOLERANCE) return "same";
  return scale < 1 ? "shrink" : "enlarge";
}

export function paperName(size: PaperSize): string {
  return /^a\d$/.test(size) ? size.toUpperCase() : size.charAt(0).toUpperCase() + size.slice(1);
}

export function formatMm(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}
