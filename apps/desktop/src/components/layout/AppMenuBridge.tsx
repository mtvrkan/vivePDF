import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useTauriEvent } from "@/shared/hooks/useTauriEvent";
import { isMac } from "@/shared/lib/platform";

const MENU_LABELS = ["about", "settings", "services", "hide", "hideOthers", "showAll", "quit", "edit", "undo", "redo", "cut", "copy", "paste", "selectAll", "window", "minimize", "zoom", "close"] as const;

export function AppMenuBridge() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMac) return;
    const labels = Object.fromEntries(MENU_LABELS.map((key) => [key, t(`appMenu.${key}`)]));
    invoke("app_menu_configure", { labels }).catch(() => undefined);
  }, [t, i18n.language]);

  useTauriEvent<string>("app-menu", (event) => {
    if (event.payload === "about") void navigate("/about");
    else if (event.payload === "settings") void navigate("/settings");
  });

  return null;
}
