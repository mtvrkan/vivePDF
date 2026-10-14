import type { DocumentNode } from "@/types/studio";

export const FOOTNOTE = "footnote";
export const MAX_FOOTNOTE = 2000;
export const MAX_FOOTNOTES = 500;
export const FOOTNOTE_VERSION = 2;
const BASE_VERSION = 1;

export function footnoteText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FOOTNOTE) : "";
}

export function hasFootnotes(node: DocumentNode | string): boolean {
  if (typeof node === "string") return false;
  return node.type === FOOTNOTE || (node.content ?? []).some(hasFootnotes);
}

export function fileVersion(content: DocumentNode | string): number {
  return hasFootnotes(content) ? FOOTNOTE_VERSION : BASE_VERSION;
}
