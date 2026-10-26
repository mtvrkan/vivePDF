import { create } from "zustand";

const ZOOM_KEY = "vivepdf.documentZoom";
const PAGE_LINES_KEY = "vivepdf.documentPageLines";
const RULER_KEY = "vivepdf.documentRuler";
const NAVIGATION_KEY = "vivepdf.documentNavigation";

export const ZOOM_STEPS = [50, 75, 90, 100, 110, 125, 150, 175, 200] as const;
export type DocumentZoom = "width" | "page" | (typeof ZOOM_STEPS)[number];

function isZoom(value: unknown): value is DocumentZoom {
  return value === "width" || value === "page" || ZOOM_STEPS.includes(value as (typeof ZOOM_STEPS)[number]);
}

function readZoom(): DocumentZoom {
  try {
    const stored = localStorage.getItem(ZOOM_KEY);
    const parsed = stored === null ? null : stored === "width" || stored === "page" ? stored : Number(stored);
    return isZoom(parsed) ? parsed : "width";
  } catch {
    return "width";
  }
}

export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}

export function steppedZoom(current: number, direction: 1 | -1): DocumentZoom {
  const percent = zoomPercent(current);
  const next = direction > 0 ? ZOOM_STEPS.find((step) => step > percent) : [...ZOOM_STEPS].reverse().find((step) => step < percent);
  return next ?? (direction > 0 ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : ZOOM_STEPS[0]);
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

type DocumentViewState = {
  zoom: DocumentZoom;
  pageLines: boolean;
  ruler: boolean;
  navigation: boolean;
  setZoom: (zoom: DocumentZoom) => void;
  setPageLines: (shown: boolean) => void;
  setRuler: (shown: boolean) => void;
  setNavigation: (shown: boolean) => void;
};

export const useDocumentViewStore = create<DocumentViewState>((set) => ({
  zoom: readZoom(),
  pageLines: readFlag(PAGE_LINES_KEY, true),
  ruler: readFlag(RULER_KEY, true),
  navigation: readFlag(NAVIGATION_KEY, false),
  setZoom: (zoom) => {
    store(ZOOM_KEY, String(zoom));
    set({ zoom });
  },
  setPageLines: (pageLines) => {
    store(PAGE_LINES_KEY, String(pageLines));
    set({ pageLines });
  },
  setRuler: (ruler) => {
    store(RULER_KEY, String(ruler));
    set({ ruler });
  },
  setNavigation: (navigation) => {
    store(NAVIGATION_KEY, String(navigation));
    set({ navigation });
  },
}));
