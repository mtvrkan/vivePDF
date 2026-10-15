import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/app/i18n";
import * as logger from "@/shared/lib/logger";
import { rpc } from "@/shared/rpc/client";
import { useEngineStore } from "@/shared/store/engineStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useToastStore } from "@/shared/store/toastStore";

export function useOffline(): boolean {
  return usePreferencesStore((state) => state.offlineMode);
}

export function useOfflineHint(): string | undefined {
  const offline = useOffline();
  const { t } = useTranslation();
  return offline ? t("offline.hint") : undefined;
}

export function isOffline(): boolean {
  return usePreferencesStore.getState().offlineMode;
}

export function refuseWhenOffline(): boolean {
  if (!isOffline()) return false;
  useToastStore.getState().push("error", i18n.t("errors.OFFLINE"));
  return true;
}

async function sendNetworkMode(offline: boolean, engineReady: boolean): Promise<void> {
  try {
    await invoke("set_offline_mode", { offline });
    if (engineReady) await rpc("system.network_mode", { offline });
  } catch (error) {
    logger.warn("offline", `network mode not applied: ${String(error)}`);
  }
}

export function syncNetworkMode(): () => void {
  void sendNetworkMode(isOffline(), useEngineStore.getState().status === "success");
  const stopPreferences = usePreferencesStore.subscribe((state, previous) => {
    if (state.offlineMode !== previous.offlineMode) void sendNetworkMode(state.offlineMode, useEngineStore.getState().status === "success");
  });
  const stopEngine = useEngineStore.subscribe((state, previous) => {
    if (state.status === "success" && previous.status !== "success") void sendNetworkMode(isOffline(), true);
  });
  return () => {
    stopPreferences();
    stopEngine();
  };
}
