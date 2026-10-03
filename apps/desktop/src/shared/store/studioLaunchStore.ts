import { create } from "zustand";

export type StudioLaunch = { path: string; password: string | null };

type StudioLaunchState = {
  pending: StudioLaunch | null;
  request: (launch: StudioLaunch) => void;
  take: () => StudioLaunch | null;
};

export function isDesignPath(path: string): boolean {
  return /\.(vivedesign|vivedoc)$/i.test(path);
}

export const useStudioLaunchStore = create<StudioLaunchState>((set, get) => ({
  pending: null,
  request: (pending) => set({ pending }),
  take: () => {
    const pending = get().pending;
    if (pending) set({ pending: null });
    return pending;
  },
}));
