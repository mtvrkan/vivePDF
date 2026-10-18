import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { sanitizeFileName } from "@/shared/lib/naming";
import { isNotGranted, type RpcCallOptions } from "@/shared/rpc/client";
import { defaultOutputDirectory, dirnameOf, joinPath, stemOf } from "@/shared/lib/paths";
import { studioDocumentImage, studioImportDocument, studioOpenDocument, studioReadBibliography, studioSaveDocument } from "@/shared/rpc/operations";
import type { RpcError } from "@/types";
import { STUDIO_DOCUMENT_EXTENSION, type BibEntry, type StudioDocument, type StudioDocumentImport } from "@/types/studio";
import { useRecentDesignsStore } from "../design/recentDesigns";
import { IMAGE_EXTENSIONS } from "../design/pickImage";
import { parseBibtex } from "./bibtex";
import { createDocument, normalizeDocument, pageSize } from "./model";
import { useDocumentStore } from "./documentStore";
import { formatOfPath, parseSources } from "./sourceFormats";
import { fileVersion } from "./footnotes";

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
  useDocumentStore.getState().flushContent();
  const state = useDocumentStore.getState();
  const document = state.document;
  if (!document) return null;
  const inPlace = !options.saveAs && state.filePath ? state.filePath : null;
  const choose = async (defaultPath?: string) => {
    const name = `${sanitizeFileName(document.name.trim()) || options.fallbackName}.${STUDIO_DOCUMENT_EXTENSION}`;
    const directory = state.filePath ? dirnameOf(state.filePath) : await defaultOutputDirectory();
    return (await saveDialog({ defaultPath: defaultPath ?? joinPath(directory, name), filters: [{ name: options.filterName, extensions: [STUDIO_DOCUMENT_EXTENSION] }] })) ?? null;
  };
  const target = inPlace ?? (await choose());
  if (!target) return null;
  const write = (output: string) => studioSaveDocument({ document: { ...document, version: fileVersion(document.content) }, output, overwrite: true });
  let result: Awaited<ReturnType<typeof write>>;
  try {
    result = await write(target);
  } catch (error) {
    if (!inPlace || !isNotGranted(error)) throw error;
    const picked = await choose(inPlace);
    if (!picked) return null;
    result = await write(picked);
  }
  if (useDocumentStore.getState().document === document) useDocumentStore.getState().markSaved(result.output);
  else useDocumentStore.setState({ filePath: result.output });
  remember(document, result.output);
  return result.output;
}

export async function pickImportFile(filterName: string): Promise<string | null> {
  const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: filterName, extensions: IMPORT_EXTENSIONS }] });
  return typeof selected === "string" ? selected : null;
}

export function importedDocument(result: StudioDocumentImport): StudioDocument {
  const document = createDocument(result.title, result.html, { author: result.author, date: result.date, referencesTitle: result.referencesTitle });
  return result.bibliography ? { ...document, sources: parseBibtex(result.bibliography).entries } : document;
}

export async function importAsDocument(path: string): Promise<StudioDocument> {
  return importedDocument(await studioImportDocument({ path }));
}

export async function readSourceLibrary(path: string, options?: RpcCallOptions): Promise<BibEntry[]> {
  const result = await studioReadBibliography({ path }, options);
  return parseSources(result.text, formatOfPath(path)).entries;
}

export async function openSourceLibrary(path: string): Promise<StudioDocument | null> {
  const entries = await readSourceLibrary(path);
  if (entries.length === 0) return null;
  return { ...createDocument(stemOf(path), '<div data-bibliography=""></div>'), sources: entries };
}

export async function pickDocumentImage(title: string): Promise<{ src: string; width: number; height: number } | null> {
  const selected = await openDialog({ multiple: false, directory: false, title, filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }] });
  if (typeof selected !== "string") return null;
  return studioDocumentImage({ path: selected });
}
