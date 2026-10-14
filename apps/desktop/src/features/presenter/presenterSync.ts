import type { BlackoutMode, BoardMode, DrawingAsset, LensShape, Stroke, usePresentationStore } from "@/shared/store/presentationStore";
import type { SelectionMarks } from "./selectionMarks";

type PresentationState = ReturnType<typeof usePresentationStore.getState>;

export type SharedSlice = {
  page: number;
  blackout: BlackoutMode;
  strokesByPage: Record<number, Stroke[]>;
  boardStrokes: Record<BoardMode, Stroke[]>;
  laserColor: string;
  laserSize: number;
  spotlightRadius: number;
  spotlightShape: LensShape;
  spotlightDim: number;
  magnifierSize: number;
  magnifierZoom: number;
  magnifierShape: LensShape;
  selection?: SelectionMarks | null;
  drawingAssets?: Record<string, DrawingAsset>;
};

export type SlicePatch = Partial<SharedSlice>;

export type StateMessage = { kind: "full"; slice: SharedSlice } | { kind: "patch"; patch: SlicePatch };

const SCALAR_KEYS = ["page", "blackout", "laserColor", "laserSize", "spotlightRadius", "spotlightShape", "spotlightDim", "magnifierSize", "magnifierZoom", "magnifierShape"] as const;

const NO_STROKES: Stroke[] = [];

function shownAssets(assets: Record<string, DrawingAsset>): Record<string, DrawingAsset> {
  return Object.fromEntries(Object.entries(assets).map(([id, asset]) => [id, { dataUrl: asset.dataUrl, width: asset.width, height: asset.height }]));
}

function addedAssets(previous: Record<string, DrawingAsset> = {}, next: Record<string, DrawingAsset> = {}): Record<string, DrawingAsset> | null {
  const added = Object.entries(next).filter(([id]) => !(id in previous));
  return added.length > 0 ? Object.fromEntries(added) : null;
}

export function sharedSlice(state: PresentationState, page: number, selection: SelectionMarks | null = null): SharedSlice {
  return {
    page,
    selection,
    drawingAssets: shownAssets(state.drawingAssets),
    blackout: state.blackout,
    strokesByPage: state.strokesByPage,
    boardStrokes: state.boardStrokes,
    laserColor: state.laserColor,
    laserSize: state.laserSize,
    spotlightRadius: state.spotlightRadius,
    spotlightShape: state.spotlightShape,
    spotlightDim: state.spotlightDim,
    magnifierSize: state.magnifierSize,
    magnifierZoom: state.magnifierZoom,
    magnifierShape: state.magnifierShape,
  };
}

function changedPages(previous: Record<number, Stroke[]>, next: Record<number, Stroke[]>): Record<number, Stroke[]> | null {
  const pages: Record<number, Stroke[]> = {};
  let changed = false;
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const pageIndex = Number(key);
    const before = previous[pageIndex] ?? NO_STROKES;
    const after = next[pageIndex] ?? NO_STROKES;
    if (before === after || (before.length === 0 && after.length === 0)) continue;
    pages[pageIndex] = after;
    changed = true;
  }
  return changed ? pages : null;
}

function boardChanged(before: Stroke[], after: Stroke[]): boolean {
  return before !== after && (before.length > 0 || after.length > 0);
}

export function diffSlice(previous: SharedSlice, next: SharedSlice): SlicePatch | null {
  const patch: SlicePatch = {};
  let changed = false;
  for (const key of SCALAR_KEYS) {
    if (previous[key] === next[key]) continue;
    Object.assign(patch, { [key]: next[key] });
    changed = true;
  }
  const assets = addedAssets(previous.drawingAssets, next.drawingAssets);
  if (assets) {
    patch.drawingAssets = assets;
    changed = true;
  }
  const pages = changedPages(previous.strokesByPage, next.strokesByPage);
  if (pages) {
    patch.strokesByPage = pages;
    changed = true;
  }
  if ((previous.selection ?? null) !== (next.selection ?? null)) {
    patch.selection = next.selection ?? null;
    changed = true;
  }
  if (boardChanged(previous.boardStrokes.black, next.boardStrokes.black) || boardChanged(previous.boardStrokes.white, next.boardStrokes.white)) {
    patch.boardStrokes = next.boardStrokes;
    changed = true;
  }
  return changed ? patch : null;
}

export function applyPatch(slice: SharedSlice, message: StateMessage): SharedSlice {
  if (message.kind === "full") return message.slice;
  const { strokesByPage, drawingAssets, ...rest } = message.patch;
  return {
    ...slice,
    ...rest,
    strokesByPage: strokesByPage ? { ...slice.strokesByPage, ...strokesByPage } : slice.strokesByPage,
    ...(drawingAssets ? { drawingAssets: { ...slice.drawingAssets, ...drawingAssets } } : {}),
  };
}

export function presentationFields(slice: SharedSlice): Omit<SharedSlice, "page" | "selection" | "drawingAssets"> & { drawingAssets: Record<string, DrawingAsset> } {
  return {
    drawingAssets: slice.drawingAssets ?? {},
    blackout: slice.blackout,
    strokesByPage: slice.strokesByPage,
    boardStrokes: slice.boardStrokes,
    laserColor: slice.laserColor,
    laserSize: slice.laserSize,
    spotlightRadius: slice.spotlightRadius,
    spotlightShape: slice.spotlightShape,
    spotlightDim: slice.spotlightDim,
    magnifierSize: slice.magnifierSize,
    magnifierZoom: slice.magnifierZoom,
    magnifierShape: slice.magnifierShape,
  };
}
