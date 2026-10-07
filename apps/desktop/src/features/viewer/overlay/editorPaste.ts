import { useDocumentStore } from "@/shared/store/documentStore";
import { useViewerOverlayStore, type EditorPending, type PastePoint } from "@/shared/store/viewerOverlayStore";
import { clipboardText, toClipboardObject, useEditorClipboard } from "./editorClipboard";
import { switchOverlayMode } from "./editorModes";
import { loadEmbeddedFont } from "./embeddedFonts";
import { isLayerLocked } from "./layers";
import { visiblePageSize } from "./pageSize";

const IMAGE_PAGE_SHARE = 0.6;
const TEXT_BOX_WIDTH_SHARE = 0.5;

export type CopyOutcome = "copied" | "unavailable" | "locked";

function writeSystemText(text: string | null) {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!text || !clipboard?.writeText) return;
  clipboard.writeText(text).catch(() => undefined);
}

export function copyEditorObject(documentId: string, object: EditorPending, cut: boolean): CopyOutcome {
  const document = useDocumentStore.getState().documents[documentId];
  const state = useViewerOverlayStore.getState();
  if (!document) return "unavailable";
  if (cut && isLayerLocked(state.lockedLayerKeys, object.pageIndex, object.id)) return "locked";
  const copied = toClipboardObject(object, { documentId, path: document.path, password: document.password, imagePreviews: state.imagePreviews });
  if (!copied) return "unavailable";
  const systemText = clipboardText(copied);
  useEditorClipboard.getState().setEntry({ object: copied, documentId, pageIndex: object.pageIndex, systemText });
  writeSystemText(systemText);
  if (cut) {
    state.snapshot();
    if ((object.kind === "edit" || object.kind === "block") && object.text !== "") state.updateObject(object.id, { text: "" });
    else if (object.kind === "imageChange") state.updateObject(object.id, { deleted: true });
    else state.removeObject(object.id);
  }
  return "copied";
}

export function loadPastedFonts(object: EditorPending | null) {
  if (!object || object.kind !== "text" || !object.fontSource || !object.runs) return;
  const source = { id: object.fontSource.key, path: object.fontSource.path, password: object.fontSource.password };
  for (const xref of new Set(object.runs.map((run) => run.fontXref).filter((xref) => xref > 0))) void loadEmbeddedFont(source, xref, null);
}

export function pasteEditorObject(documentId: string, pageIndex: number, point: PastePoint | null): EditorPending | null {
  const page = visiblePageSize(documentId, pageIndex, 1, 1);
  const pasted = useViewerOverlayStore.getState().pasteObject(documentId, pageIndex, page.width, page.height, point);
  loadPastedFonts(pasted);
  return pasted;
}

export function openEditorAndPaste(documentId: string, pageIndex: number, point: PastePoint | null): boolean {
  const entry = useEditorClipboard.getState().entry;
  if (!entry) return false;
  useEditorClipboard.getState().requestPaste({ documentId, pageIndex, point });
  switchOverlayMode(entry.object.kind === "image" ? "image" : "text");
  return true;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("unreadable picture")));
    reader.onerror = () => reject(reader.error ?? new Error("unreadable picture"));
    reader.readAsDataURL(file);
  });
}

function pictureSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("unreadable picture"));
    image.src = dataUrl;
  });
}

export function fitPicture(natural: { width: number; height: number }, page: { width: number; height: number }): { width: number; height: number } {
  const width = Math.max(1, natural.width);
  const height = Math.max(1, natural.height);
  const scale = Math.min(1, (page.width * IMAGE_PAGE_SHARE) / width, (page.height * IMAGE_PAGE_SHARE) / height);
  return { width: width * scale, height: height * scale };
}

export function centredOn(page: { width: number; height: number }, size: { width: number; height: number }, point: PastePoint | null): PastePoint {
  const x = point ? point.x : (page.width - size.width) / 2;
  const y = point ? point.y : (page.height - size.height) / 2;
  return { x: Math.min(Math.max(0, page.width - size.width), Math.max(0, x)), y: Math.min(Math.max(0, page.height - size.height), Math.max(0, y)) };
}

export async function pastePictureFiles(documentId: string, pageIndex: number, files: File[], point: PastePoint | null): Promise<number> {
  const page = visiblePageSize(documentId, pageIndex, 1, 1);
  let placed = 0;
  for (const file of files) {
    const dataUrl = await readDataUrl(file);
    const size = fitPicture(await pictureSize(dataUrl), page);
    const origin = centredOn(page, size, point ? { x: point.x + placed * 12, y: point.y + placed * 12 } : null);
    const state = useViewerOverlayStore.getState();
    state.snapshot();
    state.addObject({ id: crypto.randomUUID(), kind: "image", pageIndex, x: origin.x, y: origin.y, width: size.width, height: size.height, dataUrl, path: null, aspect: size.width / size.height, opacity: 1 });
    placed += 1;
  }
  return placed;
}

export function pastePlainText(documentId: string, pageIndex: number, text: string, point: PastePoint | null): EditorPending | null {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  if (!trimmed) return null;
  const page = visiblePageSize(documentId, pageIndex, 1, 1);
  const state = useViewerOverlayStore.getState();
  const style = state.textStyle;
  const lines = trimmed.split("\n").length;
  const size = { width: page.width * TEXT_BOX_WIDTH_SHARE, height: Math.min(page.height, Math.max(style.fontSize * 1.4, lines * style.fontSize * 1.4 + 8)) };
  const origin = centredOn(page, size, point);
  const object: EditorPending = { id: crypto.randomUUID(), kind: "text", pageIndex, x: origin.x, y: origin.y, width: size.width, height: size.height, text: trimmed, style: { ...style }, opacity: 1 };
  state.snapshot();
  state.addObject(object);
  return object;
}
