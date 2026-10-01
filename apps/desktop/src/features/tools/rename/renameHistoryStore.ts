import { create } from "zustand";
import type { RenameUndoParams } from "@/types";

type RenameHistoryState = {
  last: (RenameUndoParams & { replaced: number }) | null;
  remember: (plan: RenameUndoParams, replaced: number) => void;
  forget: () => void;
};

export const useRenameHistoryStore = create<RenameHistoryState>((set) => ({
  last: null,
  remember: (plan, replaced) => set({ last: { ...plan, replaced } }),
  forget: () => set({ last: null }),
}));
