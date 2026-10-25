import { create } from "zustand";
import type { BibEntry, DocumentNode, DocumentSettings, SourceFileOrigin, StudioDocument } from "@/types/studio";
import { normalizeDocument, normalizeSettings } from "./model";

export const DOCUMENT_DRAFT_KEY = "vivepdf.studioDocumentDraft";
const DRAFT_DELAY_MS = 800;
export const CONTENT_DELAY_MS = 250;

type DocumentState = {
  document: StudioDocument | null;
  filePath: string | null;
  sourceFile: SourceFileOrigin | null;
  dirty: boolean;
  revision: number;
  session: number;
  sourcesRequested: boolean;
  open: (document: StudioDocument, filePath?: string | null, sourceFile?: SourceFileOrigin | null) => void;
  close: () => void;
  setContent: (content: DocumentNode) => void;
  deferContent: (read: () => DocumentNode) => void;
  flushContent: () => void;
  currentContent: () => DocumentNode | string;
  setSettings: (patch: Partial<DocumentSettings>) => void;
  setName: (name: string) => void;
  setSources: (sources: BibEntry[]) => void;
  requestSources: (requested: boolean) => void;
  markSaved: (filePath: string) => void;
  markSourcesSaved: (sourceFile: SourceFileOrigin) => void;
};

type DocumentDraft = { document: StudioDocument; filePath: string | null; sourceFile: SourceFileOrigin | null };

let draftTimer: ReturnType<typeof setTimeout> | null = null;
let pendingContent: { read: () => DocumentNode; timer: ReturnType<typeof setTimeout> } | null = null;

function dropPendingContent() {
  if (pendingContent) clearTimeout(pendingContent.timer);
  pendingContent = null;
}

function storeDraft(document: StudioDocument, filePath: string | null, sourceFile: SourceFileOrigin | null) {
  try {
    localStorage.setItem(DOCUMENT_DRAFT_KEY, JSON.stringify({ document, filePath, sourceFile }));
  } catch {
    return;
  }
}

function writeDraft(document: StudioDocument, filePath: string | null, sourceFile: SourceFileOrigin | null) {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    storeDraft(document, filePath, sourceFile);
  }, DRAFT_DELAY_MS);
}

function sourceFileOf(value: unknown): SourceFileOrigin | null {
  if (!value || typeof value !== "object") return null;
  const { path, format, encoding, hash, unsafe } = value as Record<string, unknown>;
  if (typeof path !== "string" || typeof encoding !== "string" || typeof hash !== "string" || typeof unsafe !== "boolean") return null;
  return format === "bibtex" || format === "ris" || format === "csl" ? { path, format, encoding, hash, unsafe } : null;
}

export function readDocumentDraft(): DocumentDraft | null {
  try {
    const raw = localStorage.getItem(DOCUMENT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { document?: unknown; filePath?: unknown; sourceFile?: unknown };
    const document = normalizeDocument(parsed.document);
    const filePath = typeof parsed.filePath === "string" ? parsed.filePath : null;
    return document ? { document, filePath, sourceFile: filePath ? null : sourceFileOf(parsed.sourceFile) } : null;
  } catch {
    return null;
  }
}

export const useDocumentStore = create<DocumentState>((set, get) => {
  const change = (document: StudioDocument) => {
    const { filePath, sourceFile, revision } = get();
    set({ document, dirty: true, revision: revision + 1 });
    writeDraft(document, filePath, sourceFile);
  };
  return {
    document: null,
    filePath: null,
    sourceFile: null,
    dirty: false,
    revision: 0,
    session: 0,
    sourcesRequested: false,
    open: (document, filePath = null, sourceFile = null) => {
      dropPendingContent();
      set({ document, filePath, sourceFile: filePath ? null : sourceFile, dirty: false, revision: get().revision + 1, session: get().session + 1 });
      writeDraft(document, filePath, filePath ? null : sourceFile);
    },
    close: () => {
      get().flushContent();
      const { document, filePath, sourceFile } = get();
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = null;
      if (document) storeDraft(document, filePath, sourceFile);
      set({ document: null, filePath: null, sourceFile: null, dirty: false, sourcesRequested: false });
    },
    setContent: (content) => {
      const document = get().document;
      if (document && document.content !== content) change({ ...document, content });
    },
    deferContent: (read) => {
      dropPendingContent();
      pendingContent = { read, timer: setTimeout(() => get().flushContent(), CONTENT_DELAY_MS) };
    },
    flushContent: () => {
      const pending = pendingContent;
      if (!pending) return;
      dropPendingContent();
      get().setContent(pending.read());
    },
    currentContent: () => (pendingContent ? pendingContent.read() : (get().document?.content ?? "")),
    setSettings: (patch) => {
      get().flushContent();
      const document = get().document;
      if (document) change({ ...document, settings: normalizeSettings({ ...document.settings, ...patch }) });
    },
    setName: (name) => {
      get().flushContent();
      const document = get().document;
      if (document) change({ ...document, name: name.slice(0, 200) });
    },
    setSources: (sources) => {
      get().flushContent();
      const document = get().document;
      if (document && document.sources !== sources) change({ ...document, sources });
    },
    requestSources: (sourcesRequested) => set({ sourcesRequested }),
    markSaved: (filePath) => {
      set({ filePath, sourceFile: null, dirty: false });
      const document = get().document;
      if (document) writeDraft(document, filePath, null);
    },
    markSourcesSaved: (sourceFile) => {
      set({ sourceFile, dirty: false });
      const document = get().document;
      if (document) writeDraft(document, null, sourceFile);
    },
  };
});
