import { create } from "zustand";

type PrintDialogState = {
  open: boolean;
  presetPages: string | null;
  setOpen: (open: boolean, presetPages?: string | null) => void;
};

export const usePrintDialogStore = create<PrintDialogState>((set) => ({
  open: false,
  presetPages: null,
  setOpen: (open, presetPages = null) => set({ open, presetPages: open ? presetPages : null }),
}));
