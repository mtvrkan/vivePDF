import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { RpcCallError, toRpcError } from "./client";
import { readPreferences } from "@/shared/store/preferencesStore";
import type { LaunchRequest, ShellMenuEntry, ViewSource } from "@/types";

export async function readDocumentBytes(path: string): Promise<ArrayBuffer> {
  try {
    return await invoke<ArrayBuffer>("read_document", { path });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export async function openViewSource(path: string): Promise<ViewSource | null> {
  try {
    return await invoke<ViewSource | null>("view_source", { path });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export async function releaseViewSource(token: string): Promise<void> {
  await invoke("view_source_release", { token }).catch(() => undefined);
}

export function viewSourceUrl(token: string): string {
  return convertFileSrc(token, "vivepdf-view");
}

export async function writeDocumentBytes(path: string, bytes: ArrayBuffer | Uint8Array): Promise<number> {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const headers = { "x-path": encodeURIComponent(path), "x-backup": readPreferences().keepBackups ? "on" : "off" };
  try {
    return await invoke<number>("write_document", body, { headers });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export async function deleteFile(path: string): Promise<void> {
  try {
    await invoke("delete_file", { path });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export async function openProducedPicture(path: string): Promise<void> {
  try {
    await invoke("open_produced_picture", { path });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export async function searchPictureWithLens(pngBase64: string, width: number, height: number): Promise<void> {
  try {
    await invoke("search_picture_with_lens", { pngBase64, width, height });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export function launchRequest(): Promise<LaunchRequest> {
  return invoke<LaunchRequest>("launch_request");
}

export async function openDocumentWindow(paths: string[] = []): Promise<string> {
  try {
    return await invoke<string>("window_open", { paths });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export async function claimDocument(path: string): Promise<string | null> {
  try {
    return await invoke<string | null>("document_claim", { path });
  } catch {
    return null;
  }
}

export async function shareOpenDocumentPaths(paths: string[]): Promise<void> {
  try {
    await invoke("document_claims_sync", { paths });
  } catch {
    return;
  }
}

export function fileAssociationEnabled(): Promise<boolean> {
  return invoke<boolean>("file_association_enabled");
}

export async function setFileAssociation(enabled: boolean, name: string, description: string): Promise<boolean> {
  try {
    return await invoke<boolean>("set_file_association", { enabled, name, description });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export function openDefaultAppsSettings(): Promise<void> {
  return invoke<void>("open_default_apps_settings");
}

export function sendToSupported(): Promise<boolean> {
  return invoke<boolean>("send_to_supported");
}

export function sendToEnabled(name: string): Promise<boolean> {
  return invoke<boolean>("send_to_enabled", { name });
}

export async function setSendTo(enabled: boolean, name: string, description: string): Promise<boolean> {
  try {
    return await invoke<boolean>("set_send_to", { enabled, name, description });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export function rememberRecentDocument(path: string): Promise<void> {
  return invoke<void>("remember_recent_document", { path });
}

export function shellIntegrationSupported(): Promise<boolean> {
  return invoke<boolean>("shell_integration_supported");
}

export function shellIntegrationEnabled(): Promise<boolean> {
  return invoke<boolean>("shell_integration_enabled");
}

export function shellIntegrationStale(): Promise<boolean> {
  return invoke<boolean>("shell_integration_stale");
}

export function fileAssociationStale(): Promise<boolean> {
  return invoke<boolean>("file_association_stale");
}

export async function setShellIntegration(enabled: boolean, title: string, entries: ShellMenuEntry[]): Promise<boolean> {
  try {
    return await invoke<boolean>("set_shell_integration", { enabled, title, entries });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export function fileNameOf(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator >= 0 ? path.slice(separator + 1) : path;
}

export function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}
