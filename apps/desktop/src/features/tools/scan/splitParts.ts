import type { ScanSplitPart, ScanSplitPreviewPart } from "@/types";

export function partsFromPreview(parts: ScanSplitPreviewPart[]): ScanSplitPart[] {
  return parts.map((part) => ({ firstPage: part.firstPage, lastPage: part.lastPage, label: part.label }));
}

export function mergeWithPrevious(parts: ScanSplitPart[], index: number): ScanSplitPart[] {
  if (index <= 0 || index >= parts.length) return parts;
  const previous = parts[index - 1];
  const merged = { ...previous, lastPage: parts[index].lastPage, label: previous.label ?? parts[index].label };
  return [...parts.slice(0, index - 1), merged, ...parts.slice(index + 1)];
}

export function splitPartAt(parts: ScanSplitPart[], index: number, page: number): ScanSplitPart[] {
  const part = parts[index];
  if (!part || page <= part.firstPage || page > part.lastPage) return parts;
  return [...parts.slice(0, index), { ...part, lastPage: page - 1 }, { firstPage: page, lastPage: part.lastPage, label: null }, ...parts.slice(index + 1)];
}

export function relabelPart(parts: ScanSplitPart[], index: number, label: string): ScanSplitPart[] {
  if (!parts[index]) return parts;
  return parts.map((part, position) => (position === index ? { ...part, label: label.trim() ? label : null } : part));
}

export function removePart(parts: ScanSplitPart[], index: number): ScanSplitPart[] {
  return parts.filter((_, position) => position !== index);
}

export function partPages(part: ScanSplitPart): number {
  return part.lastPage - part.firstPage + 1;
}

export function sameParts(a: ScanSplitPart[], b: ScanSplitPart[]): boolean {
  return a.length === b.length && a.every((part, index) => part.firstPage === b[index].firstPage && part.lastPage === b[index].lastPage && (part.label ?? null) === (b[index].label ?? null));
}
