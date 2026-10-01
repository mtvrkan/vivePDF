import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus = "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "error" | "unconfigured";

const AUTO_CHECK_KEY = "vivepdf.autoUpdateCheck";
const UNCONFIGURED_PATTERN = /pubkey|public key|endpoint|minisign|signature|release JSON/i;

let pendingUpdate: Update | null = null;

export function readAutoCheck(): boolean {
  try {
    return localStorage.getItem(AUTO_CHECK_KEY) !== "off";
  } catch {
    return true;
  }
}

type UpdateState = {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  publishedAt: string | null;
  progress: number;
  error: string | null;
  lastChecked: number | null;
  autoCheck: boolean;
  setAutoCheck: (enabled: boolean) => void;
  check: (manual: boolean) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  publishedAt: null,
  progress: 0,
  error: null,
  lastChecked: null,
  autoCheck: readAutoCheck(),
  setAutoCheck: (enabled) => {
    try {
      localStorage.setItem(AUTO_CHECK_KEY, enabled ? "on" : "off");
    } catch {
      void 0;
    }
    set({ autoCheck: enabled });
  },
  check: async (manual) => {
    const { status } = get();
    if (status === "checking" || status === "downloading") return;
    set({ status: "checking", error: null });
    try {
      const update = await check({ timeout: 15000 });
      if (update) {
        pendingUpdate = update;
        set({ status: "available", version: update.version, notes: update.body ?? null, publishedAt: update.date ?? null, lastChecked: Date.now() });
      } else {
        pendingUpdate = null;
        set({ status: "upToDate", version: null, notes: null, publishedAt: null, lastChecked: Date.now() });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unconfigured = UNCONFIGURED_PATTERN.test(message);
      set({ status: unconfigured ? "unconfigured" : "error", error: manual || !unconfigured ? message : null, lastChecked: Date.now() });
    }
  },
  install: async () => {
    if (!pendingUpdate) return;
    set({ status: "downloading", progress: 0, error: null });
    let total = 0;
    let received = 0;
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          set({ progress: total > 0 ? Math.min(1, received / total) : 0 });
        } else if (event.event === "Finished") {
          set({ progress: 1 });
        }
      });
      set({ status: "ready", progress: 1 });
    } catch (error) {
      set({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  },
  restart: async () => {
    await relaunch();
  },
}));
