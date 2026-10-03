import type { CreatePaperSize, PaperStyle } from "@/types";

export type PaperChoice = PaperStyle | "plain";
export const MAX_PAPER_PAGES = 500;
export const PAPER_SIZES: readonly CreatePaperSize[] = ["a4", "a5", "a3", "letter"];
export const PAPER_SIZE_POINTS: Record<CreatePaperSize, [number, number]> = {
  a4: [595, 842],
  a5: [420, 595],
  a3: [842, 1191],
  letter: [612, 792],
};
