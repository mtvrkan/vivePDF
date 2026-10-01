import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { useTauriEvent } from "@/shared/hooks/useTauriEvent";
import { autostartStatus, configureTray } from "@/shared/rpc/tray";
import { requestQuit, setTrayActive } from "@/shared/session/closeGuardState";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useWatchStore } from "@/shared/store/watchStore";
import { trayWanted } from "./trayMode";

export function TrayBridge() {
  const { t, i18n } = useTranslation();
  const keepInTray = usePreferencesStore((state) => state.keepInTray);
  const activeRules = useWatchStore((state) => state.rules.filter((rule) => rule.enabled).length);
  const paused = useWatchStore((state) => state.pausedAt !== null);
  const [trayByDefault, setTrayByDefault] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    autostartStatus()
      .then((status) => {
        if (!cancelled) setTrayByDefault(status.trayByDefault);
      })
      .catch(() => {
        if (!cancelled) setTrayByDefault(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = trayByDefault !== null && trayWanted(keepInTray, activeRules, trayByDefault);

  useEffect(() => {
    if (trayByDefault === null) return;
    let cancelled = false;
    const tooltip = paused ? t("tray.tooltipPaused") : activeRules > 0 ? t("tray.tooltipWatching", { count: activeRules }) : t("tray.tooltip");
    const labels = { tooltip, open: t("tray.open"), pause: t("tray.pause"), resume: t("tray.resume"), quit: t("tray.quit") };
    configureTray(enabled, paused, labels)
      .then((active) => {
        if (!cancelled) setTrayActive(active);
      })
      .catch(() => {
        if (!cancelled) setTrayActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, paused, activeRules, trayByDefault, t, i18n.language]);

  useTauriEvent("tray-pause-toggle", () => {
    const store = useWatchStore.getState();
    store.setPaused(store.pausedAt === null);
  });

  useTauriEvent("quit-requested", () => {
    requestQuit();
    void getCurrentWindow().close();
  });

  return null;
}
