import { create } from "zustand";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import type { Toast, ToastAction, ToastKind } from "@/types";

const TOAST_LIFETIME_MS = 5000;
const TOAST_LONG_LIFETIME_MS = 10000;
const TOAST_HOLD_RETRY_MS = 1000;

type ToastState = {
  toasts: Toast[];
  held: boolean;
  setHeld: (held: boolean) => void;
  push: (kind: ToastKind, message: string, action?: ToastAction) => void;
  dismiss: (id: string) => void;
};

export function toastLifetime(kind: ToastKind, action?: ToastAction): number {
  return kind === "error" || action ? TOAST_LONG_LIFETIME_MS : TOAST_LIFETIME_MS;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  held: false,
  setHeld: (held) => set({ held }),
  push: (kind, message, action) => {
    if (kind === "success" && !usePreferencesStore.getState().successToasts) return;
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, kind, message, action }] }));
    const expire = () => {
      if (get().held) {
        window.setTimeout(expire, TOAST_HOLD_RETRY_MS);
        return;
      }
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    };
    window.setTimeout(expire, toastLifetime(kind, action));
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
