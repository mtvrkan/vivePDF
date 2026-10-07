import { create } from "zustand";

export type PrintFile = { path: string; password: string | null; pageCount: number; temporary: boolean };

type PrintDialogState = {
  open: boolean;
  presetPages: string | null;
  file: PrintFile | null;
  setOpen: (open: boolean, presetPages?: string | null) => void;
  openFile: (file: PrintFile) => void;
};

export const usePrintDialogStore = create<PrintDialogState>((set) => ({
  open: false,
  presetPages: null,
  file: null,
  setOpen: (open, presetPages = null) => set({ open, presetPages: open ? presetPages : null, file: null }),
  openFile: (file) => set({ open: true, presetPages: null, file }),
}));
