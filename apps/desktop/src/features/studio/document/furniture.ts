import type { DocumentAlign, DocumentPageNumbers } from "@/types/studio";

export const FURNITURE_PT = 8.5;
export const FURNITURE_HEIGHT = 16;
const EDGE_PT = 4;

export function furnitureOffset(margin: number): number {
  return Math.max(EDGE_PT, margin / 2 - FURNITURE_HEIGHT / 2);
}

export function numberAlign(place: DocumentPageNumbers, page: number): DocumentAlign | null {
  if (place === "none") return null;
  if (place === "outside") return page % 2 ? "right" : "left";
  return place;
}

export function numberLabel(format: string, page: number, total: number): string {
  return format.replaceAll("{n}", String(page)).replaceAll("{total}", String(total));
}
