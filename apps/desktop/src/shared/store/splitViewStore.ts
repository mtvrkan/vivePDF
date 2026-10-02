import { create } from "zustand";

export type SplitLayout = "columns" | "rows";

export type SplitView = { layout: SplitLayout; ratio: number };

export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;
const DEFAULT_RATIO = 0.5;

type SplitViewState = {
  views: Record<string, SplitView>;
  revisions: Record<string, number>;
  lastLayout: SplitLayout;
  open: (path: string, layout: SplitLayout) => void;
  close: (path: string) => void;
  toggle: (path: string) => void;
  setRatio: (path: string, ratio: number) => void;
  refresh: (path: string) => void;
};

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

export const useSplitViewStore = create<SplitViewState>((set, get) => ({
  views: {},
  revisions: {},
  lastLayout: "columns",
  open: (path, layout) =>
    set((state) => ({
      views: { ...state.views, [path]: { layout, ratio: state.views[path]?.ratio ?? DEFAULT_RATIO } },
      lastLayout: layout,
    })),
  close: (path) =>
    set((state) => {
      if (!(path in state.views)) return state;
      const views = { ...state.views };
      delete views[path];
      return { views };
    }),
  toggle: (path) => {
    if (get().views[path]) get().close(path);
    else get().open(path, get().lastLayout);
  },
  setRatio: (path, ratio) =>
    set((state) => {
      const view = state.views[path];
      return view ? { views: { ...state.views, [path]: { ...view, ratio: clampSplitRatio(ratio) } } } : state;
    }),
  refresh: (path) => set((state) => ({ revisions: { ...state.revisions, [path]: (state.revisions[path] ?? 0) + 1 } })),
}));

export function splitViewOf(state: SplitViewState, path: string | null | undefined): SplitView | null {
  return path ? (state.views[path] ?? null) : null;
}

const lastPages = new Map<string, number>();

export function rememberSplitPage(path: string, page: number) {
  if (page > 0) lastPages.set(path, page);
}

export function splitPageOf(path: string): number {
  return lastPages.get(path) ?? 1;
}
