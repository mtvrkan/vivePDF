import { create } from "zustand";
import { toRpcError } from "@/shared/rpc/client";
import { getDocumentInfo } from "@/shared/rpc/documents";
import { fileNameOf } from "@/shared/rpc/files";
import type { OpenDocument } from "@/types";

export type DocumentRegistry = { isDocumentOpen: (id: string) => boolean; setActiveDocument: (id: string) => void };

type DocumentState = {
  documents: Record<string, OpenDocument>;
  order: string[];
  activeId: string | null;
  register: (id: string, path: string, password: string | null) => void;
  setActive: (id: string | null) => void;
  activate: (id: string, registry: DocumentRegistry | null) => boolean;
  remove: (id: string) => void;
  move: (id: string, toIndex: number) => void;
  loadInfo: (id: string) => Promise<void>;
};

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: {},
  order: [],
  activeId: null,
  register: (id, path, password) =>
    set((state) => ({
      order: state.order.includes(id) ? state.order : [...state.order, id],
      documents: {
        ...state.documents,
        [id]: {
          id,
          path,
          fileName: fileNameOf(path),
          password,
          info: null,
          infoStatus: "idle",
          infoError: null,
        },
      },
    })),
  setActive: (id) => set({ activeId: id }),
  activate: (id, registry) => {
    if (!get().documents[id]) return false;
    if (registry && !registry.isDocumentOpen(id)) {
      get().remove(id);
      return false;
    }
    registry?.setActiveDocument(id);
    set({ activeId: id });
    return true;
  },
  remove: (id) =>
    set((state) => {
      const documents = { ...state.documents };
      delete documents[id];
      return { documents, order: state.order.filter((entry) => entry !== id), activeId: state.activeId === id ? null : state.activeId };
    }),
  move: (id, toIndex) =>
    set((state) => ({ order: movedTo(state.order, id, toIndex) })),
  loadInfo: async (id) => {
    const document = get().documents[id];
    if (!document) return;
    const patch = (fields: Partial<OpenDocument>) =>
      set((state) =>
        state.documents[id]
          ? { documents: { ...state.documents, [id]: { ...state.documents[id], ...fields } } }
          : state,
      );
    patch({ infoStatus: "loading", infoError: null });
    try {
      const info = await getDocumentInfo({
        path: document.path,
        password: document.password ?? undefined,
      });
      patch({ info, infoStatus: "success" });
    } catch (error) {
      patch({ infoStatus: "error", infoError: toRpcError(error) });
    }
  },
}));

export function movedTo(order: string[], id: string, toIndex: number): string[] {
  if (!order.includes(id)) return order;
  const rest = order.filter((entry) => entry !== id);
  const index = Math.min(rest.length, Math.max(0, Math.round(toIndex)));
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}

export function inTabOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

export function useActiveOpenDocument(): OpenDocument | null {
  return useDocumentStore((state) => (state.activeId ? (state.documents[state.activeId] ?? null) : null));
}
