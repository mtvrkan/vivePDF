import { create } from "zustand";
import type { PasswordRequest } from "@/types";

type OpenState = {
  busy: boolean;
  passwordRequest: PasswordRequest | null;
  waitingPaths: string[];
  afterWaiting: (() => void) | null;
  setBusy: (busy: boolean) => void;
  requestPassword: (request: PasswordRequest | null) => void;
  queueWaiting: (paths: string[]) => void;
  takeWaiting: () => string[];
  setAfterWaiting: (callback: (() => void) | null) => void;
};

export const useOpenStore = create<OpenState>((set, get) => ({
  busy: false,
  passwordRequest: null,
  waitingPaths: [],
  afterWaiting: null,
  setBusy: (busy) => set({ busy }),
  requestPassword: (passwordRequest) => set({ passwordRequest }),
  queueWaiting: (paths) => set((state) => ({ waitingPaths: [...state.waitingPaths, ...paths.filter((path) => !state.waitingPaths.includes(path))] })),
  takeWaiting: () => {
    const paths = get().waitingPaths;
    if (paths.length > 0) set({ waitingPaths: [] });
    return paths;
  },
  setAfterWaiting: (afterWaiting) => set({ afterWaiting }),
}));
