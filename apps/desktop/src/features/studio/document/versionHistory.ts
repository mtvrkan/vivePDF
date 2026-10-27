import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RpcCallError, toRpcError } from "@/shared/rpc/client";
import type { StudioDocument } from "@/types/studio";
import { fileVersion } from "./footnotes";
import { normalizeDocument } from "./model";
import { useDocumentStore } from "./documentStore";

export const AUTO_VERSION_MS = 10 * 60 * 1000;
export const VERSION_KINDS = ["open", "save", "auto", "restore"] as const;

export type VersionKind = (typeof VERSION_KINDS)[number];
export type DocumentVersion = { id: string; kind: VersionKind; savedAt: number; bytes: number };

function rpc<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args).catch((error: unknown) => {
    throw new RpcCallError(toRpcError(error));
  });
}

function isVersion(value: unknown): value is DocumentVersion {
  if (!value || typeof value !== "object") return false;
  const { id, kind, savedAt, bytes } = value as Record<string, unknown>;
  return typeof id === "string" && VERSION_KINDS.includes(kind as VersionKind) && typeof savedAt === "number" && typeof bytes === "number";
}

export function serializeVersion(document: StudioDocument): string {
  return JSON.stringify({ ...document, version: fileVersion(document.content) });
}

export function parseVersion(contents: string | null): StudioDocument | null {
  if (!contents) return null;
  try {
    return normalizeDocument(JSON.parse(contents));
  } catch {
    return null;
  }
}

export async function listVersions(path: string): Promise<DocumentVersion[]> {
  const listed = await rpc<unknown>("document_versions_list", { path });
  return Array.isArray(listed) ? listed.filter(isVersion) : [];
}

export async function readVersion(path: string, id: string): Promise<StudioDocument | null> {
  return parseVersion(await rpc<string | null>("document_versions_read", { path, id }));
}

export function writeVersion(path: string, kind: VersionKind, document: StudioDocument): Promise<DocumentVersion> {
  return rpc<DocumentVersion>("document_versions_write", { path, kind, contents: serializeVersion(document) });
}

export function recordVersion(path: string, kind: VersionKind, document: StudioDocument): void {
  void writeVersion(path, kind, document).catch(() => undefined);
}

export async function restoreVersion(path: string, id: string): Promise<boolean> {
  const restored = await readVersion(path, id);
  if (!restored) return false;
  const store = useDocumentStore.getState();
  store.flushContent();
  const current = useDocumentStore.getState().document;
  if (current) await writeVersion(path, "restore", current);
  useDocumentStore.getState().open(restored, path);
  useDocumentStore.setState({ dirty: true });
  return true;
}

export function useAutoVersions() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const snapshot = () => {
      timer = null;
      useDocumentStore.getState().flushContent();
      const { document, filePath, dirty } = useDocumentStore.getState();
      if (document && filePath && dirty) recordVersion(filePath, "auto", document);
    };
    const unsubscribe = useDocumentStore.subscribe((state, previous) => {
      if (state.revision === previous.revision || !state.dirty || !state.filePath || timer) return;
      timer = setTimeout(snapshot, AUTO_VERSION_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
