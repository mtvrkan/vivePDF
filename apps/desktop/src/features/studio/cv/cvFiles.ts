import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { RpcCallError, toRpcError } from "@/shared/rpc/client";
import { cvToJson, type CvState } from "./cvModel";

export const CV_FILE_EXTENSION = "json";

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80) || "CV";
}

export async function saveCvFile(state: CvState, name: string, filterName: string): Promise<string | null> {
  const path = await saveDialog({ defaultPath: `${safeFileName(name)}.${CV_FILE_EXTENSION}`, filters: [{ name: filterName, extensions: [CV_FILE_EXTENSION] }] });
  if (!path) return null;
  try {
    await invoke("write_text_file", { path, contents: cvToJson(state) });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
  return path;
}

export async function pickCvPdf(title: string): Promise<string | null> {
  const chosen = await openDialog({ multiple: false, directory: false, title, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return typeof chosen === "string" ? chosen : null;
}
