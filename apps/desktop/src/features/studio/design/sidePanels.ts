import { create } from "zustand";

const PANEL_KEY = "vivepdf.studioPanelOpen";
const DETAILS_KEY = "vivepdf.studioDetailsOpen";

export type DetailsSection = "arrange" | "text" | "image";

type SidePanelsState = {
  panelOpen: boolean;
  detailsOpen: boolean;
  target: { section: DetailsSection; nonce: number } | null;
  setPanelOpen: (open: boolean) => void;
  openDetails: (section?: DetailsSection) => void;
  closeDetails: () => void;
};

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

function storeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    return;
  }
}

export function detailsSectionId(section: DetailsSection): string {
  return `studio-details-${section}`;
}

export const useSidePanelsStore = create<SidePanelsState>((set, get) => ({
  panelOpen: readFlag(PANEL_KEY, true),
  detailsOpen: readFlag(DETAILS_KEY, false),
  target: null,
  setPanelOpen: (panelOpen) => {
    storeFlag(PANEL_KEY, panelOpen);
    set({ panelOpen });
  },
  openDetails: (section) => {
    storeFlag(DETAILS_KEY, true);
    set({ detailsOpen: true, target: section ? { section, nonce: (get().target?.nonce ?? 0) + 1 } : get().target });
  },
  closeDetails: () => {
    storeFlag(DETAILS_KEY, false);
    set({ detailsOpen: false });
  },
}));
