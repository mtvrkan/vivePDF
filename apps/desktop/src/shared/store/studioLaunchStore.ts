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

export function isSourceLibraryPath(path: string): boolean {
  return /\.(bib|bibtex|ris)$/i.test(path);
}

export function isStudioPath(path: string): boolean {
  return isDesignPath(path) || isSourceLibraryPath(path);
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
