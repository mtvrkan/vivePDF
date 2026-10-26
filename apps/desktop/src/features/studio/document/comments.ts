import type { DocumentNode } from "@/types/studio";

export const COMMENT = "comment";
export const COMMENTS_ATTRIBUTE = "comments";
export const COMMENT_VERSION = 5;
export const MAX_COMMENTS = 500;
export const MAX_REPLIES = 100;
export const MAX_COMMENT_TEXT = 4000;
export const MAX_COMMENT_AUTHOR = 80;

const COMMENT_ID = /^c-[a-z0-9]{1,40}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type CommentEntry = { id: string; author: string; createdAt: string; text: string };
export type CommentThread = CommentEntry & { resolved: boolean; replies: CommentEntry[] };

export function commentId(value: unknown): string | null {
  return typeof value === "string" && COMMENT_ID.test(value) ? value : null;
}

export function newCommentId(): string {
  return `c-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function commentAuthor(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_COMMENT_AUTHOR) : "";
}

function entry(value: unknown): CommentEntry | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const id = commentId(source.id);
  const text = typeof source.text === "string" ? source.text.slice(0, MAX_COMMENT_TEXT) : "";
  const createdAt = typeof source.createdAt === "string" && ISO_TIME.test(source.createdAt) ? source.createdAt : "";
  if (!id || !text.trim()) return null;
  return { id, author: commentAuthor(source.author), createdAt, text };
}

export function commentThreads(value: unknown): CommentThread[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const threads: CommentThread[] = [];
  for (const item of value.slice(0, MAX_COMMENTS)) {
    const head = entry(item);
    if (!head || seen.has(head.id)) continue;
    seen.add(head.id);
    const source = item as Record<string, unknown>;
    const replies = Array.isArray(source.replies) ? source.replies.slice(0, MAX_REPLIES).map(entry).filter((reply): reply is CommentEntry => reply !== null) : [];
    threads.push({ ...head, resolved: source.resolved === true, replies });
  }
  return threads;
}

export function hasComments(content: DocumentNode | string): boolean {
  return typeof content !== "string" && commentThreads(content.attrs?.[COMMENTS_ATTRIBUTE]).length > 0;
}

export function openCount(threads: CommentThread[]): number {
  return threads.filter((thread) => !thread.resolved).length;
}

export function initials(author: string): string {
  const words = author.split(" ").filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return letters.map((word) => word.charAt(0).toLocaleUpperCase()).join("") || "?";
}

export function commentTime(createdAt: string, locale: string, now: Date = new Date()): string {
  const when = new Date(createdAt);
  if (!createdAt || Number.isNaN(when.getTime())) return "";
  const sameDay = when.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" }).format(when);
}
