import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import * as logger from "@/shared/lib/logger";
import { buildMacMenu, keyCode, parseMenuCommand } from "@/shared/lib/macMenu";
import { isMac } from "@/shared/lib/platform";
import { isMainWindow } from "@/shared/lib/windowRole";
import { useReportStore } from "@/shared/store/reportStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useUpdateStore } from "@/shared/store/updateStore";

function pressShortcut(key: string, shiftKey: boolean): boolean {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", { key: shiftKey ? key.toUpperCase() : key, code: keyCode(key), metaKey: true, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function opaqueTopBarColor(): [number, number, number, number] | null {
  const styles = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = styles.getPropertyValue("--background").trim() || "#000";
  context.fillRect(0, 0, 1, 1);
  context.globalAlpha = 0.55;
  context.fillStyle = styles.getPropertyValue("--card").trim() || "#000";
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, 255];
}

export function AppMenuBridge() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMac || !isMainWindow()) return;
    invoke("app_menu_configure", { menu: buildMacMenu(t) }).catch((error: unknown) => logger.warn("appMenu", `menu not installed: ${String(error)}`));
  }, [t, i18n.language]);

  useEffect(() => {
    if (!isMac) return;
    const paint = () => {
      const color = opaqueTopBarColor();
      if (color) getCurrentWindow().setBackgroundColor(color).catch((error: unknown) => logger.warn("appMenu", `window colour not set: ${String(error)}`));
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isMac) return;
    const unlisten = getCurrentWebviewWindow().listen<string>("app-menu", (event) => {
      const command = parseMenuCommand(event.payload);
      if (!command) return;
      if (command.type === "navigate") void navigate(command.route);
      else if (command.type === "theme") useUiStore.getState().setTheme(command.mode);
      else if (command.type === "key") {
        const handled = pressShortcut(command.key, command.shiftKey);
        if (!handled && command.key === "w" && !command.shiftKey) void getCurrentWindow().close();
      } else if (command.name === "reportBug") useReportStore.getState().openDialog({ category: "bug" });
      else if (command.name === "suggestFeature") useReportStore.getState().openDialog({ category: "idea" });
      else if (command.name === "openLogDir") void invoke("open_log_dir");
      else if (command.name === "checkUpdates") {
        void navigate("/settings?section=updates");
        void useUpdateStore.getState().check(true);
      }
    });
    return () => {
      void unlisten.then((stop) => stop()).catch(() => undefined);
    };
  }, [navigate]);

  return null;
}
