import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import * as logger from "@/shared/lib/logger";

export type DiagnosticsInfo = {
  os: string;
  osVersion: string;
  arch: string;
  appVersion: string;
  locale: string | null;
  logPath: string;
  logTail: string;
};

type ReportCategory = "crash" | "bug" | "idea";

type ReportState = {
  open: boolean;
  category: ReportCategory;
  description: string;
  includeDiagnostics: boolean;
  diagnostics: DiagnosticsInfo | null;
  loadingDiagnostics: boolean;
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
  openDialog: (prefill) =>
    set({
      open: true,
      category: prefill?.category ?? "bug",
      description: prefill?.description ?? "",
    }),
  close: () => set({ open: false }),
  setCategory: (category) => set({ category }),
  setDescription: (description) => set({ description }),
  setIncludeDiagnostics: (value) => {
    set({ includeDiagnostics: value });
    if (value && get().diagnostics === null) void get().loadDiagnostics();
  },
  loadDiagnostics: async () => {
    set({ loadingDiagnostics: true });
    try {
      const diagnostics = await invoke<DiagnosticsInfo>("diagnostics_info");
      set({ diagnostics, loadingDiagnostics: false });
    } catch (error) {
      logger.error("report", `failed to load diagnostics: ${String(error)}`);
      set({ loadingDiagnostics: false });
    }
  },
}));
