import { invoke } from "@tauri-apps/api/core";
import { COLLECTIONS_STORAGE_KEY, readCollections } from "@/features/home/collectionsStore";
import { isMainWindow } from "@/shared/lib/windowRole";
import { readStoredHistory } from "@/shared/store/historyStore";
import { readRecentFiles } from "@/shared/store/recentStore";
import type { SessionSnapshot } from "@/types";
import { readStartupSession } from "./sessionStore";

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

export function knownPaths(snapshot: SessionSnapshot | null): string[] {
  const paths = [
    ...sessionPaths(snapshot),
    ...readRecentFiles().map((item) => item.path),
    ...storedCollectionPaths(),
    ...readStoredHistory().flatMap((entry) => [...(entry.source ? [entry.source] : []), ...entry.outputs]),
  ];
  return [...new Set(paths.filter((path) => typeof path === "string" && path.length > 0))];
}

export async function adoptKnownPaths(): Promise<void> {
  if (!isMainWindow()) return;
  await invoke("grants_adopt", { paths: knownPaths(readStartupSession()) }).catch(() => undefined);
}
