import { invoke } from "@tauri-apps/api/core";
import { RpcCallError, toRpcError } from "@/shared/rpc/client";

export const MAX_NOTE_CHARS = 20000;
export const NOTES_VERSION = 1;

export type PageNotes = Record<number, string>;

type NotesFile = { version: number; pageCount?: number; updatedAt?: string; notes?: Record<string, unknown> };

export function parseNotes(contents: string | null): PageNotes {
  if (!contents) return {};
  try {
    const file = JSON.parse(contents) as NotesFile;
    if (file.version !== NOTES_VERSION || !file.notes || typeof file.notes !== "object") return {};
    const notes: PageNotes = {};
    for (const [key, value] of Object.entries(file.notes)) {
      const pageIndex = Number(key);
      if (Number.isInteger(pageIndex) && pageIndex >= 0 && typeof value === "string" && value.length > 0) notes[pageIndex] = value.slice(0, MAX_NOTE_CHARS);
    }
    return notes;
  } catch {
    return {};
  }
}

export function serializeNotes(notes: PageNotes, pageCount: number, now: Date = new Date()): string | null {
  const entries = Object.entries(notes).filter(([, text]) => text.trim().length > 0);
  if (entries.length === 0) return null;
  const kept = Object.fromEntries(entries.map(([key, text]) => [key, text.slice(0, MAX_NOTE_CHARS)]));
  return JSON.stringify({ version: NOTES_VERSION, pageCount, updatedAt: now.toISOString(), notes: kept });
}

export async function readNotes(path: string): Promise<PageNotes> {
  try {
    return parseNotes(await invoke<string | null>("presenter_notes_read", { path }));
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export async function writeNotes(path: string, notes: PageNotes, pageCount: number): Promise<void> {
  try {
    await invoke("presenter_notes_write", { path, contents: serializeNotes(notes, pageCount) });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}
