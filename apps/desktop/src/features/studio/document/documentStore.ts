import { create } from "zustand";
import type { DocumentNode, DocumentSettings, StudioDocument } from "@/types/studio";
import { normalizeDocument, normalizeSettings } from "./model";

export const DOCUMENT_DRAFT_KEY = "vivepdf.studioDocumentDraft";
const DRAFT_DELAY_MS = 800;

type DocumentState = {
  document: StudioDocument | null;
  filePath: string | null;
  dirty: boolean;
  revision: number;
  session: number;
  open: (document: StudioDocument, filePath?: string | null) => void;
  close: () => void;
  setContent: (content: DocumentNode) => void;
  setSettings: (patch: Partial<DocumentSettings>) => void;
  setName: (name: string) => void;
  markSaved: (filePath: string) => void;
};

let draftTimer: ReturnType<typeof setTimeout> | null = null;

function storeDraft(document: StudioDocument, filePath: string | null) {
  try {
    localStorage.setItem(DOCUMENT_DRAFT_KEY, JSON.stringify({ document, filePath }));
  } catch {
    return;
  }
}

function writeDraft(document: StudioDocument, filePath: string | null) {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    storeDraft(document, filePath);
  }, DRAFT_DELAY_MS);
}

export function readDocumentDraft(): { document: StudioDocument; filePath: string | null } | null {
  try {
    const raw = localStorage.getItem(DOCUMENT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { document?: unknown; filePath?: unknown };
    const document = normalizeDocument(parsed.document);
    return document ? { document, filePath: typeof parsed.filePath === "string" ? parsed.filePath : null } : null;
  } catch {
    return null;
  }
}

export const useDocumentStore = create<DocumentState>((set, get) => {
  const change = (document: StudioDocument) => {
    const { filePath, revision } = get();
    set({ document, dirty: true, revision: revision + 1 });
    writeDraft(document, filePath);
  };
  return {
    document: null,
    filePath: null,
    dirty: false,
    revision: 0,
    session: 0,
    open: (document, filePath = null) => {
      set({ document, filePath, dirty: false, revision: get().revision + 1, session: get().session + 1 });
      writeDraft(document, filePath);
    },
    close: () => {
      const { document, filePath } = get();
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = null;
      if (document) storeDraft(document, filePath);
      set({ document: null, filePath: null, dirty: false });
    },
    setContent: (content) => {
      const document = get().document;
      if (document && document.content !== content) change({ ...document, content });
    },
    setSettings: (patch) => {
      const document = get().document;
      if (document) change({ ...document, settings: normalizeSettings({ ...document.settings, ...patch }) });
    },
    setName: (name) => {
      const document = get().document;
      if (document) change({ ...document, name: name.slice(0, 200) });
    },
    markSaved: (filePath) => {
      set({ filePath, dirty: false });
      const document = get().document;
      if (document) writeDraft(document, filePath);
    },
  };
});
