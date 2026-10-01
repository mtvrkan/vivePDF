import { create } from "zustand";
import type { PasswordRequest } from "@/types";

type OpenState = {
  busy: boolean;
  passwordRequest: PasswordRequest | null;
  waitingPaths: string[];
  setBusy: (busy: boolean) => void;
  requestPassword: (request: PasswordRequest | null) => void;
  queueWaiting: (paths: string[]) => void;
  takeWaiting: () => string[];
};

export const useOpenStore = create<OpenState>((set, get) => ({
  busy: false,
  passwordRequest: null,
  waitingPaths: [],
  setBusy: (busy) => set({ busy }),
  requestPassword: (passwordRequest) => set({ passwordRequest }),
  queueWaiting: (paths) => set((state) => ({ waitingPaths: [...state.waitingPaths, ...paths.filter((path) => !state.waitingPaths.includes(path))] })),
  takeWaiting: () => {
    const paths = get().waitingPaths;
    if (paths.length > 0) set({ waitingPaths: [] });
    return paths;
  },
}));
