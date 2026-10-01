import { create } from "zustand";

type ViewerJump = { path: string; page: number; query?: string };
type ViewerJumpConsumed = { page: number; query: string | null };

type ViewerJumpState = {
  pending: ViewerJump | null;
  request: (jump: ViewerJump) => void;
  consume: (path: string) => ViewerJumpConsumed | null;
};

export const useViewerJumpStore = create<ViewerJumpState>((set, get) => ({
  pending: null,
  request: (jump) => set({ pending: jump }),
  consume: (path) => {
    const pending = get().pending;
    if (!pending || pending.path !== path) return null;
    set({ pending: null });
    return { page: pending.page, query: pending.query ?? null };
  },
}));
