import type { DocumentNode } from "@/types/studio";
import { commentAuthor } from "./comments";

export const INSERTION = "insertion";
export const DELETION = "deletion";
export const TRACKING_ATTRIBUTE = "trackChanges";
export const TRACK_CHANGES_VERSION = 6;
export const TONE_COLOURS = ["var(--tone-security)", "var(--tone-improve)", "var(--tone-edit)", "var(--tone-organize)"];
export const AUTHOR_TONES = TONE_COLOURS.length;

const CHANGE_ID = /^r-[a-z0-9]{1,40}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type ChangeKind = "insert" | "delete" | "replace";
export type ChangeAttrs = { id: string; author: string; date: string };
export type ChangeRange = { type: typeof INSERTION | typeof DELETION; from: number; to: number };
export type TrackedChange = ChangeAttrs & { kind: ChangeKind; from: number; to: number; inserted: string; deleted: string; ranges: ChangeRange[] };
export type TrackView = "markup" | "final" | "original";

export function changeId(value: unknown): string | null {
  return typeof value === "string" && CHANGE_ID.test(value) ? value : null;
}

export function newChangeId(): string {
  return `r-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function changeDate(value: unknown): string {
  return typeof value === "string" && ISO_TIME.test(value) ? value : "";
}

export function changeAttrs(value: Record<string, unknown> | undefined): ChangeAttrs | null {
  const id = changeId(value?.id);
  return id ? { id, author: commentAuthor(value?.author), date: changeDate(value?.date) } : null;
}

export function changeKind(inserted: string, deleted: string): ChangeKind {
  if (inserted && deleted) return "replace";
  return deleted ? "delete" : "insert";
}

export function authorTone(authors: string[], author: string): number {
  const index = authors.indexOf(author);
  return (index < 0 ? 0 : index) % AUTHOR_TONES;
}

function hasMark(node: DocumentNode, names: Set<string>): boolean {
  if ((node.marks ?? []).some((mark) => names.has(mark.type))) return true;
  return (node.content ?? []).some((child) => hasMark(child, names));
}

export function hasTrackedChanges(content: DocumentNode | string): boolean {
  if (typeof content === "string") return false;
  return content.attrs?.[TRACKING_ATTRIBUTE] === true || hasMark(content, new Set([INSERTION, DELETION]));
}

const TEXT_BLOCKS = new Set(["paragraph", "heading"]);

function deleted(node: DocumentNode): boolean {
  return (node.marks ?? []).some((mark) => mark.type === DELETION);
}

function wholeDeleted(node: DocumentNode): boolean {
  return TEXT_BLOCKS.has(node.type) && (node.content ?? []).length > 0 && (node.content ?? []).every(deleted);
}

export function withoutDeleted(node: DocumentNode, keepText = false): DocumentNode {
  if (!node.content) return node;
  const content = node.content.filter((child) => (keepText ? !(deleted(child) && child.type !== "text") : !deleted(child) && !wholeDeleted(child))).map((child) => withoutDeleted(child, keepText));
  return { ...node, content };
}

export function snippet(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
