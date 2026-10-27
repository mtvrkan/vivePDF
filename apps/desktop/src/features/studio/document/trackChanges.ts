import type { Node as ProseNode } from "@tiptap/pm/model";
import type { DocumentNode } from "@/types/studio";
import { commentAuthor } from "./comments";

export const INSERTION = "insertion";
export const DELETION = "deletion";
export const TRACKING_ATTRIBUTE = "trackChanges";
export const BREAK_ATTRIBUTE = "breakChange";
export const BREAK_BLOCKS: ReadonlySet<string> = new Set(["paragraph", "heading"]);
export const ITEM_BLOCKS: ReadonlySet<string> = new Set(["listItem", "taskItem"]);
export const TRACK_CHANGES_VERSION = 6;
export const TONE_COLOURS = ["var(--tone-security)", "var(--tone-improve)", "var(--tone-edit)", "var(--tone-organize)"];
export const AUTHOR_TONES = TONE_COLOURS.length;
export const BREAK_SIGN = "¶";

const CHANGE_ID = /^r-[a-z0-9]{1,40}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type ChangeKind = "insert" | "delete" | "replace";
export type ChangeType = typeof INSERTION | typeof DELETION;
export type ChangeAttrs = { id: string; author: string; date: string };
export type BreakChange = ChangeAttrs & { type: ChangeType };
export type ChangeRange = { type: ChangeType; from: number; to: number };
export type ChangeBreak = { type: ChangeType; pos: number };
export type TrackedChange = ChangeAttrs & { kind: ChangeKind; from: number; to: number; inserted: string; deleted: string; ranges: ChangeRange[]; breaks: ChangeBreak[] };
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

export function changeType(value: unknown): ChangeType | null {
  return value === INSERTION || value === DELETION ? value : null;
}

export function breakChange(value: unknown): BreakChange | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const type = changeType(source.type);
  const attrs = type ? changeAttrs(source) : null;
  return type && attrs ? { type, ...attrs } : null;
}

export function changeKind(inserted: string, deleted: string): ChangeKind {
  if (inserted && deleted) return "replace";
  return deleted ? "delete" : "insert";
}

export function authorTone(authors: string[], author: string): number {
  const index = authors.indexOf(author);
  return (index < 0 ? 0 : index) % AUTHOR_TONES;
}

function changed(node: DocumentNode): boolean {
  if ((node.marks ?? []).some((mark) => mark.type === INSERTION || mark.type === DELETION)) return true;
  if (breakChange(node.attrs?.[BREAK_ATTRIBUTE])) return true;
  return (node.content ?? []).some(changed);
}

export function hasTrackedChanges(content: DocumentNode | string): boolean {
  if (typeof content === "string") return false;
  return content.attrs?.[TRACKING_ATTRIBUTE] === true || changed(content);
}

function deleted(node: DocumentNode): boolean {
  return (node.marks ?? []).some((mark) => mark.type === DELETION);
}

function breakDeleted(node: DocumentNode | undefined): boolean {
  return Boolean(node && BREAK_BLOCKS.has(node.type) && breakChange(node.attrs?.[BREAK_ATTRIBUTE])?.type === DELETION);
}

function joinable(node: DocumentNode | undefined): node is DocumentNode {
  return Boolean(node && BREAK_BLOCKS.has(node.type));
}

function withBreak(node: DocumentNode, value: unknown): DocumentNode {
  return { ...node, attrs: { ...node.attrs, [BREAK_ATTRIBUTE]: value ?? null } };
}

function joined(first: DocumentNode, second: DocumentNode): DocumentNode {
  return withBreak({ ...first, content: [...(first.content ?? []), ...(second.content ?? [])] }, second.attrs?.[BREAK_ATTRIBUTE]);
}

function settledItems(items: DocumentNode[]): DocumentNode[] {
  const out = [...items];
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const item = out[index];
    const blocks = item.content ?? [];
    const last = blocks.at(-1);
    if (!ITEM_BLOCKS.has(item.type) || !breakDeleted(last)) continue;
    if (blocks.length === 1 && (last?.content ?? []).length === 0 && out.length > 1) {
      out.splice(index, 1);
      continue;
    }
    const next = out[index + 1];
    const head = next?.content?.[0];
    if (next && next.type === item.type && joinable(head)) {
      out[index] = { ...item, content: [...blocks.slice(0, -1), joined(last as DocumentNode, head), ...(next.content ?? []).slice(1)] };
      out.splice(index + 1, 1);
    } else out[index] = { ...item, content: [...blocks.slice(0, -1), withBreak(last as DocumentNode, null)] };
  }
  return out;
}

function settledBlocks(blocks: DocumentNode[], parent: DocumentNode): DocumentNode[] {
  const out = [...blocks];
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const block = out[index];
    if (!breakDeleted(block)) continue;
    const empty = (block.content ?? []).length === 0;
    if (empty && out.length > 1) {
      out.splice(index, 1);
      continue;
    }
    if (empty && ITEM_BLOCKS.has(parent.type)) continue;
    const next = out[index + 1];
    if (joinable(next)) {
      out[index] = joined(block, next);
      out.splice(index + 1, 1);
    } else if (!(index === out.length - 1 && ITEM_BLOCKS.has(parent.type))) out[index] = withBreak(block, null);
  }
  return out;
}

function settledNode(node: DocumentNode): DocumentNode {
  if (!node.content) return node;
  const kept = node.content.filter((child) => !deleted(child)).map(settledNode);
  const blocks = settledBlocks(kept, node);
  return { ...node, content: node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList" ? settledItems(blocks) : blocks };
}

export function finalContent(node: DocumentNode): DocumentNode {
  return changed(node) ? settledNode(node) : node;
}

export function liveText(node: ProseNode): string {
  let text = "";
  node.descendants((child) => {
    if (child.isText && !child.marks.some((mark) => mark.type.name === DELETION)) text += child.text ?? "";
    return true;
  });
  return text;
}

export function snippet(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
