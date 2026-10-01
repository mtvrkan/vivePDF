import { create } from "zustand";
import { ttsDownload, ttsImport, ttsRemove, ttsVoices } from "@/shared/rpc/operations";
import type { RpcProgress, TtsVoice } from "@/types";

type TtsVoicesState = {
  voices: TtsVoice[];
  directory: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  downloadingId: string | null;
  downloadProgress: RpcProgress | null;
  refresh: () => Promise<void>;
  downloadVoice: (id: string) => Promise<void>;
  cancelDownload: () => void;
  removeVoice: (id: string) => Promise<void>;
  importVoice: (path: string) => Promise<string>;
};

let downloadController: AbortController | null = null;

export const useTtsVoicesStore = create<TtsVoicesState>((set, get) => ({
  voices: [],
  directory: null,
  loading: false,
  loaded: false,
  error: null,
  downloadingId: null,
  downloadProgress: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const result = await ttsVoices();
      set({ voices: result.voices, directory: result.directory, loading: false, loaded: true });
    } catch (caught) {
      set({ loading: false, loaded: true, error: caught instanceof Error ? caught.message : String(caught) });
    }
  },
  downloadVoice: async (id) => {
    const controller = new AbortController();
    downloadController = controller;
    set({ downloadingId: id, downloadProgress: null });
    try {
      await ttsDownload(id, { onProgress: (progress) => set({ downloadProgress: progress }), signal: controller.signal });
    } finally {
      if (downloadController === controller) downloadController = null;
      set({ downloadingId: null, downloadProgress: null });
    }
    await get().refresh();
  },
  cancelDownload: () => {
    downloadController?.abort();
  },
  removeVoice: async (id) => {
    await ttsRemove(id);
    await get().refresh();
  },
  importVoice: async (path) => {
    const result = await ttsImport(path);
    await get().refresh();
    return result.id;
  },
}));
