import { create } from "zustand";
import type { StudioDesign, StudioElement, StudioPage } from "@/types/studio";
import { addElements, duplicateElements, expandToGroups, removeElements, updatePage } from "../model/edit";
import { flushDraft, scheduleDraft } from "./draftStorage";
import { replaceSystemClipboard } from "./systemPaste";

export const HISTORY_LIMIT = 100;
export const MERGE_WINDOW_MS = 800;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
const PASTE_OFFSET = 12;

type ChangeOptions = { merge?: string };

type StudioState = {
  design: StudioDesign | null;
  filePath: string | null;
  dirty: boolean;
  pageId: string | null;
  selection: string[];
  groupScope: string | null;
  editingId: string | null;
  past: StudioDesign[];
  future: StudioDesign[];
  mergeKey: string | null;
  mergeAt: number;
  zoom: number;
  fit: boolean;
  clipboard: StudioElement[] | null;
  interacting: boolean;
  open: (design: StudioDesign, filePath?: string | null) => void;
  close: () => void;
  apply: (change: (design: StudioDesign) => StudioDesign, options?: ChangeOptions) => void;
  applyToPage: (change: (page: StudioPage) => StudioPage, options?: ChangeOptions) => void;
  preview: (change: (design: StudioDesign) => StudioDesign) => void;
  settle: (before: StudioDesign) => void;
  setInteracting: (interacting: boolean) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  enterGroup: (id: string) => void;
  exitGroup: () => void;
  setPage: (pageId: string) => void;
  setEditing: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setFit: () => void;
  applyFitZoom: (zoom: number) => void;
  markSaved: (filePath: string) => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  pasteInPlace: () => void;
  duplicate: () => void;
  remove: () => void;
};

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

function scopedSelection(page: StudioPage, scope: string | null, current: string[], ids: string[]): string[] | null {
  if (scope === null || !ids.length) return null;
  const members = page.elements.filter((element) => element.groupId === scope).map((element) => element.id);
  const chosen = new Set(ids);
  if (!current.some((id) => members.includes(id)) || !ids.every((id) => members.includes(id)) || members.every((id) => chosen.has(id))) return null;
  return members.filter((id) => chosen.has(id));
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
    scheduleDraft(next, state.filePath);
  };

  const restore = (design: StudioDesign, past: StudioDesign[], future: StudioDesign[]) => {
    const state = get();
    const pageId = design.pages.some((page) => page.id === state.pageId) ? state.pageId : design.pages[0].id;
    set({ design, past, future, dirty: true, mergeKey: null, pageId, selection: validSelection(design, pageId, state.selection), editingId: null });
    scheduleDraft(design, state.filePath);
  };

  const pasteClipboard = (offset: number) => {
    const state = get();
    const page = currentPage(state);
    if (!state.clipboard?.length || !page) return;
    const source = { ...page, elements: state.clipboard };
    const copies = duplicateElements(source, state.clipboard.map((element) => element.id), offset);
    const added = copies.page.elements.slice(state.clipboard.length);
    state.applyToPage((target) => addElements(target, added));
    set({ selection: added.map((element) => element.id), clipboard: added.map((element) => ({ ...element })) });
  };

  return {
    design: null,
    filePath: null,
    dirty: false,
    pageId: null,
    selection: [],
    groupScope: null,
    editingId: null,
    past: [],
    future: [],
    mergeKey: null,
    mergeAt: 0,
    zoom: 1,
    fit: true,
    clipboard: null,
    interacting: false,
    open: (design, filePath = null) => {
      set({ design, filePath, dirty: false, pageId: design.pages[0].id, selection: [], groupScope: null, editingId: null, past: [], future: [], mergeKey: null, fit: true, interacting: false });
      scheduleDraft(design, filePath);
    },
    close: () => {
      const state = get();
      if (state.design) scheduleDraft(state.design, state.filePath);
      void flushDraft();
      set({ design: null, filePath: null, dirty: false, pageId: null, selection: [], groupScope: null, editingId: null, past: [], future: [], interacting: false });
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
      scheduleDraft(state.design, state.filePath);
    },
    setInteracting: (interacting) => {
      if (get().interacting !== interacting) set({ interacting });
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
      const scoped = page ? scopedSelection(page, state.groupScope, state.selection, ids) : null;
      set({ selection: scoped ?? (page ? expandToGroups(page, ids) : []), groupScope: scoped ? state.groupScope : null, editingId: state.editingId && ids.includes(state.editingId) ? state.editingId : null });
    },
    enterGroup: (id) => {
      const state = get();
      const element = currentPage(state)?.elements.find((item) => item.id === id);
      if (!element) return;
      if (element.groupId === null) return state.select([id]);
      set({ groupScope: element.groupId, selection: [id], editingId: state.editingId === id ? id : null });
    },
    exitGroup: () => {
      const state = get();
      set({ groupScope: null });
      state.select(state.selection);
    },
    setPage: (pageId) => set({ pageId, selection: [], groupScope: null, editingId: null }),
    setEditing: (editingId) => set({ editingId }),
    setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)), fit: false }),
    setFit: () => set({ fit: true }),
    applyFitZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),
    markSaved: (filePath) => {
      set({ filePath, dirty: false });
      const design = get().design;
      if (design) scheduleDraft(design, filePath);
    },
    copy: () => {
      const elements = selectedElements(get());
      if (!elements.length) return;
      set({ clipboard: structuredClone(elements) });
      replaceSystemClipboard(elements);
    },
    cut: () => {
      get().copy();
      get().remove();
    },
    paste: () => pasteClipboard(PASTE_OFFSET),
    pasteInPlace: () => pasteClipboard(0),
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
