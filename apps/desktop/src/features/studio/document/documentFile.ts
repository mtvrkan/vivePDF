import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { sanitizeFileName } from "@/shared/lib/naming";
import { isNotGranted, type RpcCallOptions } from "@/shared/rpc/client";
import { basenameOf, defaultOutputDirectory, dirnameOf, joinPath, stemOf } from "@/shared/lib/paths";
import { studioDocumentImage, studioImportDocument, studioOpenDocument, studioReadBibliography, studioSaveDocument, studioWriteBibliography } from "@/shared/rpc/operations";
import type { RpcError } from "@/types";
import { STUDIO_DOCUMENT_EXTENSION, type BibEntry, type SourceFileOrigin, type StudioDocument, type StudioDocumentImport } from "@/types/studio";
import { useRecentDesignsStore } from "../design/recentDesigns";
import { IMAGE_EXTENSIONS } from "../design/pickImage";
import { parseBibtex, type BibParseResult } from "./bibtex";
import { writeBack } from "./bibtexWriteBack";
import { createDocument, normalizeDocument, pageSize } from "./model";
import { useDocumentStore } from "./documentStore";
import { FORMAT_EXTENSIONS, formatOfPath, parseSources, writeSources } from "./sourceFormats";
import { fileVersion } from "./footnotes";
import i18n from "i18next";

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

export type OpenedSourceLibrary = { document: StudioDocument; origin: SourceFileOrigin | null; parsed: BibParseResult };

export async function openSourceLibraryFile(path: string): Promise<OpenedSourceLibrary | null> {
  const read = await studioReadBibliography({ path });
  const format = formatOfPath(path);
  const parsed = parseSources(read.text, format);
  if (parsed.entries.length === 0) return null;
  const document = { ...createDocument(stemOf(path), '<div data-bibliography=""></div>'), sources: parsed.entries };
  const origin = format === "bibtex" ? { path, format, encoding: read.encoding, hash: read.hash, unsafe: read.lossy } : null;
  return { document, origin, parsed };
}

export async function openSourceLibrary(path: string): Promise<StudioDocument | null> {
  return (await openSourceLibraryFile(path))?.document ?? null;
}

function refusal(reason: string, data: Record<string, unknown> = {}): RpcError {
  return { code: "INVALID_PARAMS", message: reason, data: { reason, ...data } };
}

export async function saveSourceLibrary(filterName: string): Promise<string | null> {
  useDocumentStore.getState().flushContent();
  const { document, sourceFile: origin } = useDocumentStore.getState();
  if (!document || !origin) return null;
  if (origin.unsafe) throw refusal("sourceSaveUnsafe", { name: basenameOf(origin.path) });
  const current = await studioReadBibliography({ path: origin.path });
  if (current.hash !== origin.hash) throw refusal("sourceChangedOnDisk", { name: basenameOf(origin.path) });
  const library = origin.format === "bibtex" ? parseBibtex(current.text).library : undefined;
  const text = library ? writeBack(library, document.sources) : writeSources(document.sources, origin.format);
  const write = (output: string, expectedHash: string | null) => studioWriteBibliography({ text, output, encoding: origin.encoding, expectedHash, overwrite: true });
  let result: Awaited<ReturnType<typeof write>>;
  try {
    result = await write(origin.path, origin.hash);
  } catch (error) {
    if (!isNotGranted(error)) throw error;
    const picked = await saveDialog({ defaultPath: origin.path, filters: [{ name: filterName, extensions: [FORMAT_EXTENSIONS[origin.format]] }] });
    if (!picked) return null;
    result = await write(picked, picked === origin.path ? origin.hash : null);
  }
  if (useDocumentStore.getState().document === document) useDocumentStore.getState().markSourcesSaved({ ...origin, path: result.output, hash: result.hash });
  return result.output;
}

export async function pickDocumentImage(title: string): Promise<{ src: string; width: number; height: number } | null> {
  const selected = await openDialog({ multiple: false, directory: false, title, filters: [{ name: i18n.t("fileFilters.images"), extensions: IMAGE_EXTENSIONS }] });
  if (typeof selected !== "string") return null;
  return studioDocumentImage({ path: selected });
}
