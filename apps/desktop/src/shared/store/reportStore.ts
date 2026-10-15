import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import * as logger from "@/shared/lib/logger";

export type DiagnosticsInfo = {
  os: string;
  osVersion: string;
  arch: string;
  appVersion: string;
  logPath: string;
  logTail: string;
};

type ReportCategory = "crash" | "bug" | "idea";

export type ReportImage = { id: string; name: string; base64: string; mime: string };

type ReportState = {
  open: boolean;
  category: ReportCategory;
  description: string;
  includeDiagnostics: boolean;
  diagnostics: DiagnosticsInfo | null;
  loadingDiagnostics: boolean;
  diagnosticsFailed: boolean;
  attachments: string[];
  images: ReportImage[];
  addAttachments: (paths: string[]) => void;
  removeAttachment: (path: string) => void;
  addImage: (image: ReportImage) => void;
  removeImage: (id: string) => void;
  openDialog: (prefill?: { category?: ReportCategory; description?: string }) => void;
  close: () => void;
  setCategory: (category: ReportCategory) => void;
  setDescription: (description: string) => void;
  setIncludeDiagnostics: (value: boolean) => void;
  loadDiagnostics: () => Promise<void>;
};

export const useReportStore = create<ReportState>((set, get) => ({
  open: false,
  category: "bug",
  description: "",
  includeDiagnostics: false,
  diagnostics: null,
  loadingDiagnostics: false,
  diagnosticsFailed: false,
  attachments: [],
  images: [],
  addAttachments: (paths) => set((state) => ({ attachments: [...state.attachments, ...paths.filter((path, index) => !state.attachments.includes(path) && paths.indexOf(path) === index)] })),
  removeAttachment: (path) => set((state) => ({ attachments: state.attachments.filter((entry) => entry !== path) })),
  addImage: (image) => set((state) => ({ images: [...state.images, image] })),
  removeImage: (id) => set((state) => ({ images: state.images.filter((image) => image.id !== id) })),
  openDialog: (prefill) =>
    set({
      open: true,
      category: prefill?.category ?? "bug",
      description: prefill?.description ?? "",
    }),
  close: () => set({ open: false, attachments: [], images: [] }),
  setCategory: (category) => set({ category }),
  setDescription: (description) => set({ description }),
  setIncludeDiagnostics: (value) => set({ includeDiagnostics: value }),
  loadDiagnostics: async () => {
    if (get().loadingDiagnostics) return;
    set({ loadingDiagnostics: true, diagnosticsFailed: false });
    try {
      const diagnostics = await invoke<DiagnosticsInfo | null>("diagnostics_info");
      if (!diagnostics || typeof diagnostics.logTail !== "string") throw new Error("no diagnostics");
      set({ diagnostics, loadingDiagnostics: false });
    } catch (error) {
      logger.error("report", `failed to load diagnostics: ${String(error)}`);
      set({ loadingDiagnostics: false, diagnosticsFailed: true });
    }
  },
}));
