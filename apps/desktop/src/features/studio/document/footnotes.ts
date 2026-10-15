import type { DocumentNode } from "@/types/studio";
import { hasSectionBreaks } from "./sections";

export const FOOTNOTE = "footnote";
export const MAX_FOOTNOTE = 2000;
export const MAX_FOOTNOTE_HTML = 20000;
export const MAX_FOOTNOTES = 500;
export const FOOTNOTE_VERSION = 2;
const BASE_VERSION = 1;

export function footnoteText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FOOTNOTE) : "";
}

export function footnoteMarkup(value: unknown): string {
  if (typeof value !== "string") return "";
  const markup = value.trim();
  return markup.length <= MAX_FOOTNOTE_HTML ? markup : "";
}

export function hasFootnotes(node: DocumentNode | string): boolean {
  if (typeof node === "string") return node.includes("data-footnote");
  return node.type === FOOTNOTE || (node.content ?? []).some(hasFootnotes);
}

export function fileVersion(content: DocumentNode | string): number {
  return hasFootnotes(content) || hasSectionBreaks(content) ? FOOTNOTE_VERSION : BASE_VERSION;
}
