import { invoke } from "@tauri-apps/api/core";
import { RpcCallError, toRpcError } from "./client";
import type { AutostartStatus, TrayLabels } from "@/types";

export async function configureTray(enabled: boolean, paused: boolean, labels: TrayLabels): Promise<boolean> {
  try {
    return await invoke<boolean>("tray_configure", { enabled, paused, labels });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export async function hideToTray(): Promise<boolean> {
  try {
    return await invoke<boolean>("window_hide_to_tray");
  } catch {
    return false;
  }
}

export async function autostartStatus(): Promise<AutostartStatus> {
  try {
    return await invoke<AutostartStatus>("autostart_status");
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export async function setAutostart(enabled: boolean): Promise<AutostartStatus> {
  try {
    return await invoke<AutostartStatus>("autostart_set", { enabled });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}
