import { create } from "zustand";
import type { Editor } from "@tiptap/react";
import { useCommentsView } from "./commentsView";
import type { TrackView } from "./trackChanges";

const VIEW_KEY = "vivepdf.documentTrackView";
const PANEL_KEY = "vivepdf.documentChangesPanel";
const VIEWS: readonly TrackView[] = ["markup", "final", "original"];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function storedView(): TrackView {
  const value = read(VIEW_KEY);
  return VIEWS.find((view) => view === value) ?? "markup";
}

type TrackChangesViewState = {
  view: TrackView;
  panel: boolean;
  hiddenAuthors: string[];
  pendingTrack: boolean;
  setPendingTrack: (pendingTrack: boolean) => void;
  setView: (view: TrackView) => void;
  setPanel: (panel: boolean) => void;
  toggleAuthor: (author: string) => void;
};

export const TRACK_VIEWS = VIEWS;

export const useTrackChangesView = create<TrackChangesViewState>((set) => ({
  view: storedView(),
  panel: read(PANEL_KEY) === "true",
  hiddenAuthors: [],
  pendingTrack: false,
  setPendingTrack: (pendingTrack) => set({ pendingTrack }),
  setView: (view) => {
    write(VIEW_KEY, view);
    set({ view });
  },
  setPanel: (panel) => {
    write(PANEL_KEY, String(panel));
    set({ panel });
  },
  toggleAuthor: (author) => set((state) => ({ hiddenAuthors: state.hiddenAuthors.includes(author) ? state.hiddenAuthors.filter((item) => item !== author) : [...state.hiddenAuthors, author] })),
}));

export function setTracking(editor: Editor, on: boolean): void {
  if (on && !useCommentsView.getState().author) {
    useTrackChangesView.getState().setPendingTrack(true);
    useCommentsView.getState().setNaming(true);
    return;
  }
  useTrackChangesView.getState().setPendingTrack(false);
  editor.chain().focus().setTrackChanges(on).run();
}
