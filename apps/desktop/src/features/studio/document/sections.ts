import type { DocumentColumns, DocumentNode } from "@/types/studio";

export const SECTION_BREAK = "sectionBreak";
export const CONTINUOUS = "continuous";
export const SECTION_COLUMNS: DocumentColumns[] = [1, 2, 3];
const DEFAULT_SECTION_COLUMNS: DocumentColumns = 2;

export function sectionColumns(value: unknown): DocumentColumns {
  const number = typeof value === "string" ? Number(value) : value;
  return SECTION_COLUMNS.find((columns) => columns === number) ?? DEFAULT_SECTION_COLUMNS;
}

export function sectionKind(value: unknown): typeof CONTINUOUS | undefined {
  return value === CONTINUOUS ? CONTINUOUS : undefined;
}

export function hasSectionBreaks(node: DocumentNode | string): boolean {
  if (typeof node === "string") return node.includes("data-section-break");
  return node.type === SECTION_BREAK || (node.content ?? []).some(hasSectionBreaks);
}
