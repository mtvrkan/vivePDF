import { create } from "zustand";

export type SavedSignature = { id: string; name: string; dataUrl: string; width: number; height: number; createdAt: number };

const STORAGE_KEY = "vivepdf.signatures";
const MAX_SIGNATURES = 12;

export function readStored(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSignature[];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item.dataUrl === "string" && item.width > 0 && item.height > 0) : [];
  } catch {
    return [];
  }
}

function persist(items: SavedSignature[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    return;
  }
}

type SignatureState = {
  items: SavedSignature[];
  add: (item: Omit<SavedSignature, "id" | "createdAt">) => SavedSignature;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  clear: () => void;
};

export const useSignatureStore = create<SignatureState>((set, get) => ({
  items: readStored(),
  add: (item) => {
    const saved: SavedSignature = { ...item, id: crypto.randomUUID(), createdAt: Date.now() };
    const items = [saved, ...get().items].slice(0, MAX_SIGNATURES);
    persist(items);
    set({ items });
    return saved;
  },
  rename: (id, name) => {
    const items = get().items.map((item) => (item.id === id ? { ...item, name } : item));
    persist(items);
    set({ items });
  },
  remove: (id) => {
    const items = get().items.filter((item) => item.id !== id);
    persist(items);
    set({ items });
  },
  clear: () => {
    persist([]);
    set({ items: [] });
  },
}));
