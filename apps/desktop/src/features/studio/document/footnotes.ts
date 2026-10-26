import type { DocumentNode } from "@/types/studio";
import { citationItems, type CitationItem } from "./citationItems";
import { hasSectionBreaks } from "./sections";
import { COMMENT_VERSION, hasComments } from "./comments";
import { EQUATION_VERSION, hasEquations } from "./equations";

export const FOOTNOTE = "footnote";
export const MAX_FOOTNOTE = 2000;
export const MAX_FOOTNOTE_HTML = 20000;
export const MAX_FOOTNOTES = 500;
export const MAX_FOOTNOTE_LINES = 12;
export const MAX_FOOTNOTE_PICTURES = 4;
export const MAX_FOOTNOTE_PICTURE = 200_000;
export const FOOTNOTE_PICTURE_SIDE = 192;
export const FOOTNOTE_VERSION = 2;
export const RICH_FOOTNOTE_VERSION = 3;
const BASE_VERSION = 1;

export const FOOTNOTE_PICTURE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;
const PICTURE_SOURCE = /(<img\b[^>]*?\ssrc=")(data:[^"]*)"/gi;
const CITATION_ATTRIBUTE = /\sdata-citation="([^"]*)"/gi;
const RICH_MARKUP = /<br\b|<img\b|data-citation=/i;
const RICH_STRING = /data-footnote(?:-html)?="[^"]*(?:&lt;(?:br|img)\b|data-citation|\n)/i;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

export function footnoteText(value: unknown): string {
  if (typeof value !== "string") return "";
  const lines = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());
  while (lines.length > 0 && !lines[0]) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
  const kept = lines.length > MAX_FOOTNOTE_LINES ? [...lines.slice(0, MAX_FOOTNOTE_LINES - 1), lines.slice(MAX_FOOTNOTE_LINES - 1).join(" ")] : lines;
  return kept.join("\n").slice(0, MAX_FOOTNOTE);
}

export function footnoteMarkup(value: unknown): string {
  if (typeof value !== "string") return "";
  const markup = value.trim();
  const pictures = [...markup.matchAll(PICTURE_SOURCE)].map((match) => match[2]);
  if (pictures.length > MAX_FOOTNOTE_PICTURES || pictures.some((source) => source.length > MAX_FOOTNOTE_PICTURE)) return "";
  return markup.replace(PICTURE_SOURCE, "$1\"").length <= MAX_FOOTNOTE_HTML ? markup : "";
}

export function unescapeAttribute(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_match, name: string) => ENTITIES[name]);
}

export function noteCitation(payload: string): CitationItem[] {
  try {
    return citationItems(JSON.parse(unescapeAttribute(payload)));
  } catch {
    return [];
  }
}

export function footnoteCitations(markup: string): CitationItem[][] {
  return [...markup.matchAll(CITATION_ATTRIBUTE)].map((match) => noteCitation(match[1]));
}

export function hasFootnotes(node: DocumentNode | string): boolean {
  if (typeof node === "string") return node.includes("data-footnote");
  return node.type === FOOTNOTE || (node.content ?? []).some(hasFootnotes);
}

function hasRichFootnotes(node: DocumentNode | string): boolean {
  if (typeof node === "string") return RICH_STRING.test(node);
  if (node.type === FOOTNOTE) return footnoteText(node.attrs?.text).includes("\n") || RICH_MARKUP.test(footnoteMarkup(node.attrs?.html));
  return (node.content ?? []).some(hasRichFootnotes);
}

export function fileVersion(content: DocumentNode | string): number {
  if (hasComments(content)) return COMMENT_VERSION;
  if (hasEquations(content)) return EQUATION_VERSION;
  if (hasRichFootnotes(content)) return RICH_FOOTNOTE_VERSION;
  return hasFootnotes(content) || hasSectionBreaks(content) ? FOOTNOTE_VERSION : BASE_VERSION;
}
