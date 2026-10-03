import { create } from "zustand";
import { toolShortcuts } from "@/app/navigation";
import { defaultHomeLayout, normalizeHomeLayout, type HomeLayout } from "./homeLayout";

export const HOME_LAYOUT_KEY = "vivepdf.homeLayout";

const knownTools = new Set(toolShortcuts.map((tool) => tool.id));

function readStored(): HomeLayout {
  try {
    const raw = localStorage.getItem(HOME_LAYOUT_KEY);
    return raw ? normalizeHomeLayout(JSON.parse(raw), knownTools) : defaultHomeLayout();
  } catch {
    return defaultHomeLayout();
  }
}

function persist(layout: HomeLayout) {
  try {
    localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    return;
  }
}

type HomeLayoutState = {
  layout: HomeLayout;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  change: (update: (layout: HomeLayout) => HomeLayout) => void;
  replace: (layout: HomeLayout) => void;
};

export const useHomeLayoutStore = create<HomeLayoutState>((set, get) => ({
  layout: readStored(),
  editing: false,
  setEditing: (editing) => set({ editing }),
  change: (update) => {
    const next = update(get().layout);
    if (next === get().layout) return;
    persist(next);
    set({ layout: next });
  },
  replace: (layout) => {
    persist(layout);
    set({ layout });
  },
}));
