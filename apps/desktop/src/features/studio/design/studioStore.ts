import { create } from "zustand";
import type { StudioDesign, StudioElement, StudioPage } from "@/types/studio";
import { normalizeDesign } from "../model/design";
import { addElements, duplicateElements, expandToGroups, removeElements, updatePage } from "../model/edit";

export const STUDIO_DRAFT_KEY = "vivepdf.studioDraft";
export const HISTORY_LIMIT = 100;
export const MERGE_WINDOW_MS = 800;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
const PASTE_OFFSET = 12;
const DRAFT_DELAY_MS = 600;

type ChangeOptions = { merge?: string };

type StudioState = {
  design: StudioDesign | null;
  filePath: string | null;
  dirty: boolean;
  pageId: string | null;
  selection: string[];
  editingId: string | null;
  past: StudioDesign[];
  future: StudioDesign[];
  mergeKey: string | null;
  mergeAt: number;
  zoom: number;
  fit: boolean;
  clipboard: StudioElement[] | null;
  open: (design: StudioDesign, filePath?: string | null) => void;
  close: () => void;
  apply: (change: (design: StudioDesign) => StudioDesign, options?: ChangeOptions) => void;
  applyToPage: (change: (page: StudioPage) => StudioPage, options?: ChangeOptions) => void;
  preview: (change: (design: StudioDesign) => StudioDesign) => void;
  settle: (before: StudioDesign) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  setPage: (pageId: string) => void;
  setEditing: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setFit: () => void;
  applyFitZoom: (zoom: number) => void;
  markSaved: (filePath: string) => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  duplicate: () => void;
  remove: () => void;
};

let draftTimer: ReturnType<typeof setTimeout> | null = null;

function storeDraft(design: StudioDesign, filePath: string | null) {
  try {
    localStorage.setItem(STUDIO_DRAFT_KEY, JSON.stringify({ design, filePath }));
  } catch {
    return;
  }
}

function writeDraft(design: StudioDesign, filePath: string | null) {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    storeDraft(design, filePath);
  }, DRAFT_DELAY_MS);
}

export function readDraft(): { design: StudioDesign; filePath: string | null } | null {
  try {
    const raw = localStorage.getItem(STUDIO_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { design?: unknown; filePath?: unknown };
    const design = normalizeDesign(parsed.design);
    return design ? { design, filePath: typeof parsed.filePath === "string" ? parsed.filePath : null } : null;
  } catch {
    return null;
  }
}

export function currentPage(state: Pick<StudioState, "design" | "pageId">): StudioPage | null {
  const design = state.design;
  if (!design) return null;
  return design.pages.find((page) => page.id === state.pageId) ?? design.pages[0];
}

export function selectedElements(state: Pick<StudioState, "design" | "pageId" | "selection">): StudioElement[] {
  const page = currentPage(state);
  if (!page) return [];
  const chosen = new Set(state.selection);
  return page.elements.filter((element) => chosen.has(element.id));
}

function validSelection(design: StudioDesign, pageId: string | null, selection: string[]): string[] {
  const page = design.pages.find((item) => item.id === pageId) ?? design.pages[0];
  const present = new Set(page.elements.map((element) => element.id));
  return selection.filter((id) => present.has(id));
}

export const useStudioStore = create<StudioState>((set, get) => {
  const record = (next: StudioDesign, options?: ChangeOptions) => {
    const state = get();
    const current = state.design;
    if (!current || next === current) return;
    const now = Date.now();
    const merging = options?.merge !== undefined && options.merge === state.mergeKey && now - state.mergeAt < MERGE_WINDOW_MS;
    const past = merging ? state.past : [...state.past, current].slice(-HISTORY_LIMIT);
    const pageId = next.pages.some((page) => page.id === state.pageId) ? state.pageId : next.pages[0].id;
    set({ design: next, past, future: [], dirty: true, mergeKey: options?.merge ?? null, mergeAt: now, pageId, selection: validSelection(next, pageId, state.selection) });
    writeDraft(next, state.filePath);
  };

  const restore = (design: StudioDesign, past: StudioDesign[], future: StudioDesign[]) => {
    const state = get();
    const pageId = design.pages.some((page) => page.id === state.pageId) ? state.pageId : design.pages[0].id;
    set({ design, past, future, dirty: true, mergeKey: null, pageId, selection: validSelection(design, pageId, state.selection), editingId: null });
    writeDraft(design, state.filePath);
  };

  return {
    design: null,
    filePath: null,
    dirty: false,
    pageId: null,
    selection: [],
    editingId: null,
    past: [],
    future: [],
    mergeKey: null,
    mergeAt: 0,
    zoom: 1,
    fit: true,
    clipboard: null,
    open: (design, filePath = null) => {
      set({ design, filePath, dirty: false, pageId: design.pages[0].id, selection: [], editingId: null, past: [], future: [], mergeKey: null, fit: true });
      writeDraft(design, filePath);
    },
    close: () => {
      const state = get();
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = null;
      if (state.design) storeDraft(state.design, state.filePath);
      set({ design: null, filePath: null, dirty: false, pageId: null, selection: [], editingId: null, past: [], future: [] });
    },
    apply: (change, options) => {
      const design = get().design;
      if (design) record(change(design), options);
    },
    applyToPage: (change, options) => {
      const state = get();
      const page = currentPage(state);
      if (state.design && page) record(updatePage(state.design, page.id, change), options);
    },
    preview: (change) => {
      const design = get().design;
      if (!design) return;
      const next = change(design);
      if (next !== design) set({ design: next });
    },
    settle: (before) => {
      const state = get();
      if (!state.design || state.design === before) return;
      set({ past: [...state.past, before].slice(-HISTORY_LIMIT), future: [], dirty: true, mergeKey: null });
      writeDraft(state.design, state.filePath);
    },
    undo: () => {
      const state = get();
      if (!state.design || !state.past.length) return;
      restore(state.past[state.past.length - 1], state.past.slice(0, -1), [state.design, ...state.future].slice(0, HISTORY_LIMIT));
    },
    redo: () => {
      const state = get();
      if (!state.design || !state.future.length) return;
      restore(state.future[0], [...state.past, state.design].slice(-HISTORY_LIMIT), state.future.slice(1));
    },
    select: (ids) => {
      const state = get();
      const page = currentPage(state);
      set({ selection: page ? expandToGroups(page, ids) : [], editingId: state.editingId && ids.includes(state.editingId) ? state.editingId : null });
    },
    setPage: (pageId) => set({ pageId, selection: [], editingId: null }),
    setEditing: (editingId) => set({ editingId }),
    setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)), fit: false }),
    setFit: () => set({ fit: true }),
    applyFitZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),
    markSaved: (filePath) => {
      set({ filePath, dirty: false });
      const design = get().design;
      if (design) writeDraft(design, filePath);
    },
    copy: () => {
      const elements = selectedElements(get());
      if (elements.length) set({ clipboard: structuredClone(elements) });
    },
    cut: () => {
      get().copy();
      get().remove();
    },
    paste: () => {
      const state = get();
      const page = currentPage(state);
      if (!state.clipboard?.length || !page) return;
      const source = { ...page, elements: state.clipboard };
      const copies = duplicateElements(source, state.clipboard.map((element) => element.id), PASTE_OFFSET);
      const added = copies.page.elements.slice(state.clipboard.length);
      state.applyToPage((target) => addElements(target, added));
      set({ selection: added.map((element) => element.id), clipboard: added.map((element) => ({ ...element })) });
    },
    duplicate: () => {
      const state = get();
      const page = currentPage(state);
      if (!page || !state.selection.length) return;
      const result = duplicateElements(page, state.selection, PASTE_OFFSET);
      state.applyToPage(() => result.page);
      set({ selection: result.ids });
    },
    remove: () => {
      const state = get();
      if (!state.selection.length) return;
      state.applyToPage((page) => removeElements(page, state.selection));
      set({ selection: [], editingId: null });
    },
  };
});
