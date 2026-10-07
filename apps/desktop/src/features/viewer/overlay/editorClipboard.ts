import { create } from "zustand";
import type { EditorPending } from "@/shared/store/viewerOverlayStore";
import { imagePreviewKey } from "./layers";

export type ClipboardObject = Extract<EditorPending, { kind: "text" | "image" }>;
export type EditorClipboardEntry = { object: ClipboardObject; documentId: string; pageIndex: number; systemText: string | null };
export type PasteRequest = { documentId: string; pageIndex: number; point: { x: number; y: number } | null };
export type CopySource = { documentId: string; path: string; password: string | null; imagePreviews: Record<string, string> };

type EditorClipboardState = {
  entry: EditorClipboardEntry | null;
  pasteRequest: PasteRequest | null;
  setEntry: (entry: EditorClipboardEntry | null) => void;
  requestPaste: (request: PasteRequest) => void;
  takePasteRequest: (documentId: string) => PasteRequest | null;
};

export const useEditorClipboard = create<EditorClipboardState>((set, get) => ({
  entry: null,
  pasteRequest: null,
  setEntry: (entry) => set({ entry }),
  requestPaste: (request) => set({ pasteRequest: request }),
  takePasteRequest: (documentId) => {
    const request = get().pasteRequest;
    if (!request || request.documentId !== documentId) return null;
    set({ pasteRequest: null });
    return request;
  },
}));

function hasEmbeddedRuns(runs: { fontXref: number }[] | undefined): boolean {
  return !!runs?.some((run) => run.fontXref > 0);
}

export function toClipboardObject(item: EditorPending, source: CopySource): ClipboardObject | null {
  const fontSource = { path: source.path, password: source.password, key: `clip-${crypto.randomUUID()}` };
  if (item.kind === "block") {
    const runs = item.runs.map((run) => ({ ...run }));
    return {
      id: item.id,
      kind: "text",
      pageIndex: item.pageIndex,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      text: item.text,
      style: { fontSize: item.style.fontSize, color: item.style.color, bold: item.style.bold, align: item.style.align === "justify" ? "left" : item.style.align },
      opacity: item.opacity,
      runs,
      fontSource: hasEmbeddedRuns(runs) ? fontSource : undefined,
    };
  }
  if (item.kind === "edit") {
    return { id: item.id, kind: "text", pageIndex: item.pageIndex, x: item.x, y: item.y, width: item.width, height: item.height, text: item.text, style: { fontSize: item.style.fontSize, color: item.style.color, bold: item.style.bold, align: item.style.align }, opacity: item.opacity };
  }
  if (item.kind === "imageChange") {
    const dataUrl = item.replacement?.dataUrl ?? source.imagePreviews[imagePreviewKey(source.documentId, item.pageIndex, item.xref)] ?? null;
    if (!dataUrl) return null;
    return { id: item.id, kind: "image", pageIndex: item.pageIndex, x: item.x, y: item.y, width: item.width, height: item.height, dataUrl, path: item.replacement?.path ?? null, aspect: item.aspect, opacity: item.opacity };
  }
  if (item.kind === "text") {
    const runs = item.runs?.map((run) => ({ ...run }));
    if (item.fontSource) return { ...item, runs, fontSource: { ...item.fontSource } };
    return { ...item, runs, fontSource: hasEmbeddedRuns(runs) ? fontSource : undefined };
  }
  return { ...item };
}

export function holdsEditorObject(data: Pick<DataTransfer, "getData" | "files" | "items"> | null, entry: EditorClipboardEntry): boolean {
  if (!data) return true;
  const hasPicture = Array.from(data.items ?? []).some((item) => item.kind === "file") || (data.files?.length ?? 0) > 0;
  if (hasPicture) return false;
  const text = data.getData("text/plain");
  return !text.trim() || text === entry.systemText;
}

export function clipboardText(object: ClipboardObject): string | null {
  return object.kind === "text" && object.text.trim() ? object.text : null;
}
