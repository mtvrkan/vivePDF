import { create } from "zustand";
import { languagePacks } from "@/shared/lib/translateLanguage";
import { translateDownload, translateImport, translateModels, translateRemove } from "@/shared/rpc/operations";
import type { RpcProgress, TranslateModel } from "@/types";

type TranslateModelsState = {
  models: TranslateModel[];
  directory: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  downloadingLanguage: string | null;
  downloadProgress: RpcProgress | null;
  refresh: () => Promise<void>;
  downloadLanguage: (code: string) => Promise<void>;
  cancelDownload: () => void;
  importModel: (path: string) => Promise<string>;
  removeModel: (id: string) => Promise<void>;
  removeLanguage: (code: string) => Promise<void>;
};

let downloadController: AbortController | null = null;

function packOf(models: TranslateModel[], code: string) {
  return languagePacks(models).find((pack) => pack.code === code);
}

export const useTranslateModelsStore = create<TranslateModelsState>((set, get) => ({
  models: [],
  directory: null,
  loading: false,
  loaded: false,
  error: null,
  downloadingLanguage: null,
  downloadProgress: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const result = await translateModels();
      set({ models: result.models, directory: result.directory, loading: false, loaded: true });
    } catch (caught) {
      set({ loading: false, loaded: true, error: caught instanceof Error ? caught.message : String(caught) });
    }
  },
  downloadLanguage: async (code) => {
    const missing = packOf(get().models, code)?.missing ?? [];
    if (missing.length === 0) return;
    const controller = new AbortController();
    downloadController = controller;
    set({ downloadingLanguage: code, downloadProgress: null });
    try {
      for (const [index, id] of missing.entries()) {
        await translateDownload(id, {
          onProgress: (progress) => set({ downloadProgress: { ...progress, progress: (index + progress.progress) / missing.length } }),
          signal: controller.signal,
        });
      }
    } finally {
      if (downloadController === controller) downloadController = null;
      set({ downloadingLanguage: null, downloadProgress: null });
      await get().refresh();
    }
  },
  cancelDownload: () => {
    downloadController?.abort();
  },
  importModel: async (path) => {
    const result = await translateImport(path);
    await get().refresh();
    return result.id;
  },
  removeModel: async (id) => {
    await translateRemove(id);
    await get().refresh();
  },
  removeLanguage: async (code) => {
    const installed = packOf(get().models, code)?.pairs.filter((model) => model.installed) ?? [];
    try {
      for (const model of installed) await translateRemove(model.id);
    } finally {
      await get().refresh();
    }
  },
}));
