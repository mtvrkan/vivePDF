import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { RpcCallError, toRpcError } from "@/shared/rpc/client";
import { studioImageInfo, studioSaveImage } from "@/shared/rpc/operations";
import { cvToJson, type CvFile, type CvState } from "./cvModel";

export const CV_FILE_EXTENSION = "json";
const PHOTO_SIDE = 1600;

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[\s.]+$/, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return `CV ${cleaned}`;
  return cleaned || "CV";
}

export async function saveCvFile(state: CvState, name: string, filterName: string): Promise<string | null> {
  const path = await saveDialog({ defaultPath: `${safeFileName(name)}.${CV_FILE_EXTENSION}`, filters: [{ name: filterName, extensions: [CV_FILE_EXTENSION] }] });
  if (!path) return null;
  const photo = state.profile.photo ? await studioImageInfo({ path: state.profile.photo, maxSide: PHOTO_SIDE }).then((info) => info.base64, () => null) : null;
  try {
    await invoke("write_text_file", { path, contents: cvToJson(state, photo) });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
  return path;
}

export async function pickCvPdf(title: string): Promise<string | null> {
  const chosen = await openDialog({ multiple: false, directory: false, title, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return typeof chosen === "string" ? chosen : null;
}

export async function withStoredPhoto(file: CvFile): Promise<CvState> {
  if (!file.photoData) return { profile: file.profile, theme: file.theme };
  const saved = await studioSaveImage({ data: file.photoData }).catch(() => null);
  return { profile: saved ? { ...file.profile, photo: saved.path } : { ...file.profile, photo: null, photoCrop: null }, theme: file.theme };
}
