import type { DocumentCaptionKind } from "@/types/studio";

export const CAPTION = "caption";
export const CAPTION_KINDS: DocumentCaptionKind[] = ["figure", "table"];
const FALLBACK_LABELS: Record<DocumentCaptionKind, string> = { figure: "Figure", table: "Table" };

export function captionKind(value: unknown): DocumentCaptionKind {
  return value === "table" ? "table" : "figure";
}

export function captionLabel(label: unknown, kind: DocumentCaptionKind, number: number): string {
  const word = typeof label === "string" && label.trim() ? label.trim() : FALLBACK_LABELS[kind];
  return `${word} ${number}.`;
}

export class CaptionCounter {
  private counts: Record<DocumentCaptionKind, number> = { figure: 0, table: 0 };

  next(kind: DocumentCaptionKind): number {
    this.counts[kind] += 1;
    return this.counts[kind];
  }
}
