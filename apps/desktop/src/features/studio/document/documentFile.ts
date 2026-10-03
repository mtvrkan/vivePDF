import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { sanitizeFileName } from "@/shared/lib/naming";
import { defaultOutputDirectory, dirnameOf, joinPath, stemOf } from "@/shared/lib/paths";
import { studioDocumentImage, studioImportDocument, studioOpenDocument, studioSaveDocument } from "@/shared/rpc/operations";
import type { RpcError } from "@/types";
import { STUDIO_DOCUMENT_EXTENSION, type StudioDocument } from "@/types/studio";
import { useRecentDesignsStore } from "../design/recentDesigns";
import { IMAGE_EXTENSIONS } from "../design/pickImage";
import { createDocument, normalizeDocument, pageSize } from "./model";
import { useDocumentStore } from "./documentStore";

export const IMPORT_EXTENSIONS = ["md", "markdown", "txt", "html", "htm"];

export function isDocumentPath(path: string): boolean {
  return new RegExp(`\\.${STUDIO_DOCUMENT_EXTENSION}$`, "i").test(path);
}

function remember(document: StudioDocument, path: string) {
  const size = pageSize(document.settings);
  useRecentDesignsStore.getState().add({ path, name: document.name || stemOf(path), savedAt: Date.now(), width: size.width, height: size.height, thumbnail: "" });
}

export async function loadStudioDocument(path: string): Promise<StudioDocument> {
  const result = await studioOpenDocument({ path });
  const document = normalizeDocument(result.document);
  if (!document) {
    const error: RpcError = { code: "INVALID_PARAMS", message: "not a document", data: { reason: "noDocument" } };
    throw error;
  }
  remember(document, path);
  return document;
}

export async function saveStudioDocument(options: { saveAs: boolean; fallbackName: string; filterName: string }): Promise<string | null> {
  const state = useDocumentStore.getState();
  const document = state.document;
  if (!document) return null;
  let target = !options.saveAs && state.filePath ? state.filePath : null;
  if (!target) {
    const name = `${sanitizeFileName(document.name.trim()) || options.fallbackName}.${STUDIO_DOCUMENT_EXTENSION}`;
    const directory = state.filePath ? dirnameOf(state.filePath) : await defaultOutputDirectory();
    target = (await saveDialog({ defaultPath: joinPath(directory, name), filters: [{ name: options.filterName, extensions: [STUDIO_DOCUMENT_EXTENSION] }] })) ?? null;
  }
  if (!target) return null;
  const result = await studioSaveDocument({ document, output: target, overwrite: true });
  if (useDocumentStore.getState().document === document) useDocumentStore.getState().markSaved(result.output);
  else useDocumentStore.setState({ filePath: result.output });
  remember(document, result.output);
  return result.output;
}

export async function pickImportFile(filterName: string): Promise<string | null> {
  const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: filterName, extensions: IMPORT_EXTENSIONS }] });
  return typeof selected === "string" ? selected : null;
}

export async function importAsDocument(path: string): Promise<StudioDocument> {
  const result = await studioImportDocument({ path });
  return createDocument(result.title, result.html);
}

export async function pickDocumentImage(title: string): Promise<{ src: string; width: number; height: number } | null> {
  const selected = await openDialog({ multiple: false, directory: false, title, filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }] });
  if (typeof selected !== "string") return null;
  return studioDocumentImage({ path: selected });
}
