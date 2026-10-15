import { invoke } from "@tauri-apps/api/core";
import { COLLECTIONS_STORAGE_KEY, readCollections } from "@/features/home/collectionsStore";
import { readRecentDesigns } from "@/features/studio/design/recentDesigns";
import { isMainWindow } from "@/shared/lib/windowRole";
import { readStoredHistory } from "@/shared/store/historyStore";
import { readPreferences } from "@/shared/store/preferencesStore";
import { readRecentFiles } from "@/shared/store/recentStore";
import { readStored as readWatchRules } from "@/shared/store/watchStore";
import type { SessionSnapshot } from "@/types";
import { readStartupSession } from "./sessionStore";

const DOCUMENT_DRAFT_STORAGE_KEY = "vivepdf.studioDocumentDraft";

export type KnownFolders = { readFolders: string[]; writeFolders: string[] };

function sessionPaths(snapshot: SessionSnapshot | null): string[] {
  if (!snapshot) return [];
  return [
    ...snapshot.documents,
    ...(snapshot.activePath ? [snapshot.activePath] : []),
    ...(snapshot.organizer ? [snapshot.organizer.mainPath, ...snapshot.organizer.sources.map((source) => source.path)] : []),
  ];
}

function storedCollectionPaths(): string[] {
  try {
    return readCollections(localStorage.getItem(COLLECTIONS_STORAGE_KEY)).flatMap((collection) => collection.paths);
  } catch {
    return [];
  }
}

function storedJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function studioPaths(): string[] {
  const draft = storedJson(DOCUMENT_DRAFT_STORAGE_KEY) as { filePath?: unknown } | null;
  return [...readRecentDesigns().map((design) => design.path), ...(typeof draft?.filePath === "string" ? [draft.filePath] : [])];
}

function distinct(paths: string[]): string[] {
  return [...new Set(paths.filter((path) => typeof path === "string" && path.length > 0))];
}

export function knownPaths(snapshot: SessionSnapshot | null): string[] {
  return distinct([
    ...sessionPaths(snapshot),
    ...readRecentFiles().map((item) => item.path),
    ...storedCollectionPaths(),
    ...readStoredHistory().flatMap((entry) => [...(entry.source ? [entry.source] : []), ...entry.outputs]),
    ...studioPaths(),
  ]);
}

export function knownFolders(): KnownFolders {
  const rules = readWatchRules();
  return {
    readFolders: distinct(rules.map((rule) => rule.folder)),
    writeFolders: distinct([...rules.map((rule) => rule.outputDir), readPreferences().outputFolder]),
  };
}

export async function adoptKnownPaths(): Promise<void> {
  if (!isMainWindow()) return;
  await invoke("grants_adopt", { paths: knownPaths(readStartupSession()), ...knownFolders() }).catch(() => undefined);
}
