import { create } from "zustand";

export type ViewerPanels = {
  thumbnails: boolean;
  outline: boolean;
  search: boolean;
  inspector: boolean;
  annotate: boolean;
  comments: boolean;
  attachments: boolean;
  readAloud: boolean;
  reading: boolean;
  present: boolean;
  translate: boolean;
  signatures: boolean;
  layers: boolean;
};

const STORAGE_KEY = "vivepdf.viewerPanels";
const DEFAULT_PANELS: ViewerPanels = { thumbnails: true, outline: false, search: false, inspector: false, annotate: false, comments: false, attachments: false, readAloud: false, reading: false, present: false, translate: false, signatures: false, layers: false };

export function readStored(): ViewerPanels {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PANELS;
    const parsed = JSON.parse(raw) as Partial<ViewerPanels>;
    return { ...DEFAULT_PANELS, thumbnails: parsed.thumbnails ?? true, outline: parsed.outline ?? false, inspector: parsed.inspector ?? false, comments: parsed.comments ?? false };
  } catch {
    return DEFAULT_PANELS;
  }
}

function persist(panels: ViewerPanels) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ thumbnails: panels.thumbnails, outline: panels.outline, inspector: panels.inspector, comments: panels.comments }));
  } catch {
    return;
  }
}

type ViewerPanelsState = {
  panels: ViewerPanels;
  setPanels: (update: ViewerPanels | ((panels: ViewerPanels) => ViewerPanels)) => void;
  toggle: (panel: keyof ViewerPanels) => void;
};

export const useViewerPanelsStore = create<ViewerPanelsState>((set, get) => ({
  panels: readStored(),
  setPanels: (update) => {
    const panels = typeof update === "function" ? update(get().panels) : update;
    persist(panels);
    set({ panels });
  },
  toggle: (panel) => {
    const panels = { ...get().panels, [panel]: !get().panels[panel] };
    persist(panels);
    set({ panels });
  },
}));
