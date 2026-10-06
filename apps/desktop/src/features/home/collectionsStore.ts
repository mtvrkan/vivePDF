import { create } from "zustand";
import { GROUP_COLORS, isGroupColor, type GroupColor } from "@/features/viewer/tabGroups";
import { pathKey } from "@/shared/lib/paths";

export const COLLECTIONS_STORAGE_KEY = "vivepdf.collections";
export const COLLECTION_NAME_MAX = 40;
export const COLLECTION_FILES_MAX = 50;

export type Collection = { id: string; name: string; color: GroupColor; paths: string[]; pinned?: true };

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = pathKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanName(name: string): string {
  return name.trim().slice(0, COLLECTION_NAME_MAX);
}

export function readCollections(raw: string | null): Collection[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const entry = item as Partial<Record<keyof Collection, unknown>>;
      if (typeof entry.id !== "string" || typeof entry.name !== "string" || !Array.isArray(entry.paths)) return [];
      const paths = uniquePaths(entry.paths.filter((path): path is string => typeof path === "string")).slice(0, COLLECTION_FILES_MAX);
      const collection: Collection = { id: entry.id, name: cleanName(entry.name), color: isGroupColor(entry.color) ? entry.color : GROUP_COLORS[0], paths };
      return [entry.pinned === true ? { ...collection, pinned: true } : collection];
    });
  } catch {
    return [];
  }
}

function loadStored(): Collection[] {
  try {
    return readCollections(localStorage.getItem(COLLECTIONS_STORAGE_KEY));
  } catch {
    return [];
  }
}

function persist(collections: Collection[]) {
  try {
    localStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(collections));
  } catch {
    return;
  }
}

export function nextCollectionColor(collections: Collection[]): GroupColor {
  const used = new Set(collections.map((collection) => collection.color));
  return GROUP_COLORS.find((color) => !used.has(color)) ?? GROUP_COLORS[collections.length % GROUP_COLORS.length];
}

export function pinnedFirst(collections: Collection[]): Collection[] {
  return [...collections.filter((collection) => collection.pinned), ...collections.filter((collection) => !collection.pinned)];
}

export function moveCollection(collections: Collection[], id: string, index: number): Collection[] {
  const ordered = pinnedFirst(collections);
  const moving = ordered.find((collection) => collection.id === id);
  if (!moving) return collections;
  const rest = ordered.filter((collection) => collection.id !== id);
  const pinnedCount = rest.filter((collection) => collection.pinned).length;
  const target = moving.pinned ? Math.max(0, Math.min(pinnedCount, index)) : Math.max(pinnedCount, Math.min(rest.length, index));
  return [...rest.slice(0, target), moving, ...rest.slice(target)];
}

export function withPinned(collections: Collection[], id: string, pinned: boolean): Collection[] {
  const moving = collections.find((collection) => collection.id === id);
  if (!moving) return collections;
  const updated: Collection = { ...moving, pinned: true };
  if (!pinned) delete updated.pinned;
  const others = pinnedFirst(collections.filter((collection) => collection.id !== id));
  const pinnedCount = others.filter((collection) => collection.pinned).length;
  return [...others.slice(0, pinnedCount), updated, ...others.slice(pinnedCount)];
}

type CollectionsState = {
  collections: Collection[];
  create: (name: string, paths: string[]) => string;
  rename: (id: string, name: string) => void;
  recolor: (id: string, color: GroupColor) => void;
  addPaths: (id: string, paths: string[]) => void;
  removePath: (id: string, path: string) => void;
  removePaths: (id: string, paths: string[]) => void;
  remove: (id: string) => void;
  move: (id: string, index: number) => void;
  setPinned: (id: string, pinned: boolean) => void;
  restore: (collections: Collection[]) => void;
};

export const useCollectionsStore = create<CollectionsState>((set, get) => {
  const update = (collections: Collection[]) => {
    persist(collections);
    set({ collections });
  };
  const change = (id: string, edit: (collection: Collection) => Collection) => update(get().collections.map((collection) => (collection.id === id ? edit(collection) : collection)));
  return {
    collections: loadStored(),
    create: (name, paths) => {
      const id = crypto.randomUUID();
      const collections = get().collections;
      update([...collections, { id, name: cleanName(name), color: nextCollectionColor(collections), paths: uniquePaths(paths).slice(0, COLLECTION_FILES_MAX) }]);
      return id;
    },
    rename: (id, name) => change(id, (collection) => ({ ...collection, name: cleanName(name) })),
    recolor: (id, color) => change(id, (collection) => ({ ...collection, color })),
    addPaths: (id, paths) => change(id, (collection) => ({ ...collection, paths: uniquePaths([...collection.paths, ...paths]).slice(0, COLLECTION_FILES_MAX) })),
    removePath: (id, path) => change(id, (collection) => ({ ...collection, paths: collection.paths.filter((entry) => pathKey(entry) !== pathKey(path)) })),
    removePaths: (id, paths) => {
      const keys = new Set(paths.map(pathKey));
      change(id, (collection) => ({ ...collection, paths: collection.paths.filter((entry) => !keys.has(pathKey(entry))) }));
    },
    remove: (id) => update(get().collections.filter((collection) => collection.id !== id)),
    move: (id, index) => update(moveCollection(get().collections, id, index)),
    setPinned: (id, pinned) => update(withPinned(get().collections, id, pinned)),
    restore: (collections) => update(collections),
  };
});
