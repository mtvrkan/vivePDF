import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTauriEvent } from "@/shared/hooks/useTauriEvent";
import { requestQuit } from "./closeGuardState";

export function WindowQuitBridge() {
  useTauriEvent("quit-requested", () => {
    requestQuit();
    void getCurrentWindow().close();
  });
  return null;
}
