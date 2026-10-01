import { create } from "zustand";
import type { EditorBlockInfo, EditorFontResolution, EditorWarning, TextSpan } from "@/types";
import { pastePosition } from "@/features/viewer/overlay/clipboard";
import type { DrawingKind, DrawingSource } from "@/features/viewer/overlay/drawing/drawingSource";
import { applyStyleToRuns } from "@/features/viewer/overlay/runs";

export type OverlayMode = "crop" | "measure" | "signature" | "redact" | "link" | "text" | "image" | "areaText" | "snapshot";
export const EDITOR_MODES: OverlayMode[] = ["text", "image"];
export type PagePoint = { x: number; y: number };
export type PageSelection = { pageIndex: number; x0: number; y0: number; x1: number; y1: number };
export type AreaTextRequest = PageSelection & { token: number };
export type MeasureState = { pageIndex: number; points: PagePoint[] };
export type SignaturePlacement = { pageIndex: number; x: number; y: number };
export type MeasureUnit = "mm" | "cm" | "m";
export type TextAlign = "left" | "center" | "right";
export type TextStyle = { fontSize: number; color: string; bold: boolean; align: TextAlign; fontId?: string };
export type PendingImage = { dataUrl: string; width: number; height: number; path: string | null; drawing?: DrawingSource };
export type ReplaceStyle = TextStyle & { italic: boolean; font: string | null };
export type BlockAlign = TextAlign | "justify";
export type BlockStyle = { fontSize: number; color: string; bold: boolean; italic: boolean; font: string | null; align: BlockAlign; lineHeight: number };
export type ObjectRect = { x: number; y: number; width: number; height: number };
export type ImageRotation = 0 | 90 | 180 | 270;
export type FocusRequest = { page: number; x: number; y: number };
export type RunStyle = { font: string | null; fontXref: number; size: number; color: string; bold: boolean; italic: boolean; superscript: boolean };
export type BlockRun = RunStyle & { text: string };
export type EditorPending =
  | { id: string; kind: "text"; pageIndex: number; x: number; y: number; width: number; height: number; text: string; style: TextStyle; opacity: number; runs?: BlockRun[] }
  | { id: string; kind: "edit"; pageIndex: number; x: number; y: number; width: number; height: number; text: string; original: string; spanId: string; style: ReplaceStyle; opacity: number }
  | {
      id: string;
      kind: "block";
      pageIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
      original: string;
      originalRect: ObjectRect;
      blockId: string;
      style: BlockStyle;
      originalStyle: BlockStyle;
      fontXref: number;
      fontExt: string;
      fontFamily: string;
      runs: BlockRun[];
      originalRuns: BlockRun[];
      firstLineIndent: number;
      leading: number;
      rotated: boolean;
      fittedSize: number | null;
      opacity: number;
    }
  | { id: string; kind: "imageChange"; pageIndex: number; x: number; y: number; width: number; height: number; blockId: string; xref: number; original: ObjectRect; deleted: boolean; aspect: number; aspectLocked: boolean; replacement: PendingImage | null; rotate: ImageRotation; flipH: boolean; flipV: boolean; opacity: number; placementRotation: ImageRotation }
  | { id: string; kind: "image"; pageIndex: number; x: number; y: number; width: number; height: number; dataUrl: string; path: string | null; aspect: number; opacity: number; drawing?: DrawingSource; alt?: string };
export type DrawingEditorRequest = { kind: DrawingKind; objectId: string | null };

type OverlayState = {
  mode: OverlayMode | null;
  selection: PageSelection | null;
  measure: MeasureState | null;
  scaleDenominator: number;
  unit: MeasureUnit;
  signatureId: string | null;
  signatureWidthMm: number;
  placement: SignaturePlacement | null;
  objects: EditorPending[];
  selectedObjectId: string | null;
  editingObjectId: string | null;
  textStyle: TextStyle;
  pendingImage: PendingImage | null;
  drawingEditor: DrawingEditorRequest | null;
  openDrawingEditor: (kind: DrawingKind, objectId: string | null) => void;
  closeDrawingEditor: () => void;
  spansByPage: Record<number, TextSpan[]>;
  setSpans: (pageIndex: number, spans: TextSpan[]) => void;
  blocksByPage: Record<number, EditorBlockInfo[]>;
  setBlocks: (pageIndex: number, blocks: EditorBlockInfo[]) => void;
  hiddenLayerKeys: Record<string, true>;
  toggleLayerHidden: (key: string) => void;
  lockedLayerKeys: Record<string, true>;
  toggleLayerLocked: (key: string) => void;
  hoveredLayerKey: string | null;
  setHoveredLayerKey: (key: string | null) => void;
  fontFamilies: Record<string, string>;
  setFontFamily: (key: string, family: string) => void;
  imagePreviews: Record<string, string>;
  setImagePreview: (key: string, dataUrl: string) => void;
  warnings: EditorWarning[];
  setWarnings: (warnings: EditorWarning[]) => void;
  fontResolutions: Record<string, EditorFontResolution>;
  setFontResolution: (objectId: string, resolution: EditorFontResolution) => void;
  focusRequest: FocusRequest | null;
  requestFocusAt: (request: FocusRequest) => void;
  clearFocusRequest: () => void;
  areaTextRequest: AreaTextRequest | null;
  snapshotRequest: AreaTextRequest | null;
  requestSnapshot: (selection: PageSelection) => void;
  clearSnapshot: () => void;
  requestAreaText: (selection: PageSelection) => void;
  clearAreaText: () => void;
  past: EditorPending[][];
  future: EditorPending[][];
  snapshot: () => void;
  undo: () => void;
  redo: () => void;
  setMode: (mode: OverlayMode | null) => void;
  setSelection: (selection: PageSelection | null) => void;
  addMeasurePoint: (pageIndex: number, point: PagePoint) => void;
  resetMeasure: () => void;
  setScaleDenominator: (value: number) => void;
  setUnit: (unit: MeasureUnit) => void;
  setSignatureId: (id: string | null) => void;
  setSignatureWidthMm: (value: number) => void;
  setPlacement: (placement: SignaturePlacement | null) => void;
  addObject: (object: EditorPending) => void;
  updateObject: (id: string, patch: Partial<EditorPending>) => void;
  removeObject: (id: string) => void;
  clearObjects: () => void;
  setSelectedObject: (id: string | null) => void;
  setEditingObject: (id: string | null) => void;
  setTextStyle: (patch: Partial<TextStyle>) => void;
  setPendingImage: (image: PendingImage | null) => void;
  clipboard: { object: EditorPending; pageIndex: number } | null;
  copyObject: (object: EditorPending) => void;
  pasteObject: (targetPageIndex: number, pageWidth: number, pageHeight: number) => void;
  leaveNext: (() => void) | null;
  requestLeave: (next: () => void, hasPending: boolean) => boolean;
  cancelLeave: () => void;
};

function withStylePatch(item: Extract<EditorPending, { kind: "text" | "edit" | "block" }>, patch: Partial<TextStyle>): EditorPending {
  const next = { ...item, style: { ...item.style, ...patch } } as EditorPending;
  if (item.kind === "block") return { ...next, runs: applyStyleToRuns(item.runs, patch) } as EditorPending;
  if (item.kind === "text" && item.runs) return { ...next, runs: applyStyleToRuns(item.runs, patch) } as EditorPending;
  return next;
}

const DEFAULT_TEXT_STYLE: TextStyle = { fontSize: 14, color: "#111111", bold: false, align: "left" };

function toPastedObject(item: EditorPending, imagePreviews: Record<string, string>, sourcePageIndex: number, targetPageIndex: number, x: number, y: number): EditorPending {
  const id = crypto.randomUUID();
  if (item.kind === "block") {
    return { id, kind: "text", pageIndex: targetPageIndex, x, y, width: item.width, height: item.height, text: item.text, style: { fontSize: item.style.fontSize, color: item.style.color, bold: item.style.bold, align: item.style.align === "justify" ? "left" : item.style.align }, opacity: item.opacity, runs: item.runs.map((run) => ({ ...run })) };
  }
  if (item.kind === "imageChange") {
    const dataUrl = item.replacement?.dataUrl ?? imagePreviews[`${sourcePageIndex}:${item.xref}`] ?? null;
    if (!dataUrl) return { ...item, id, pageIndex: targetPageIndex, x, y };
    return { id, kind: "image", pageIndex: targetPageIndex, x, y, width: item.width, height: item.height, dataUrl, path: item.replacement?.path ?? null, aspect: item.aspect, opacity: item.opacity };
  }
  return { ...item, id, pageIndex: targetPageIndex, x, y };
}

export const useViewerOverlayStore = create<OverlayState>((set, get) => ({
  mode: null,
  selection: null,
  measure: null,
  scaleDenominator: 1,
  unit: "mm",
  signatureId: null,
  signatureWidthMm: 50,
  placement: null,
  objects: [],
  selectedObjectId: null,
  editingObjectId: null,
  textStyle: DEFAULT_TEXT_STYLE,
  pendingImage: null,
  drawingEditor: null,
  openDrawingEditor: (kind, objectId) => set({ drawingEditor: { kind, objectId } }),
  closeDrawingEditor: () => set({ drawingEditor: null }),
  spansByPage: {},
  setSpans: (pageIndex, spans) => set({ spansByPage: { ...get().spansByPage, [pageIndex]: spans } }),
  blocksByPage: {},
  setBlocks: (pageIndex, blocks) => set({ blocksByPage: { ...get().blocksByPage, [pageIndex]: blocks } }),
  hiddenLayerKeys: {},
  toggleLayerHidden: (key) => {
    const current = { ...get().hiddenLayerKeys };
    if (current[key]) delete current[key];
    else current[key] = true;
    set({ hiddenLayerKeys: current });
  },
  lockedLayerKeys: {},
  toggleLayerLocked: (key) => {
    const current = { ...get().lockedLayerKeys };
    if (current[key]) delete current[key];
    else current[key] = true;
    set({ lockedLayerKeys: current });
  },
  hoveredLayerKey: null,
  setHoveredLayerKey: (key) => set({ hoveredLayerKey: key }),
  fontFamilies: {},
  setFontFamily: (key, family) => set({ fontFamilies: { ...get().fontFamilies, [key]: family } }),
  imagePreviews: {},
  setImagePreview: (key, dataUrl) => set({ imagePreviews: { ...get().imagePreviews, [key]: dataUrl } }),
  warnings: [],
  setWarnings: (warnings) => set({ warnings }),
  fontResolutions: {},
  setFontResolution: (objectId, resolution) => set({ fontResolutions: { ...get().fontResolutions, [objectId]: resolution } }),
  focusRequest: null,
  requestFocusAt: (request) => set({ focusRequest: request }),
  clearFocusRequest: () => set({ focusRequest: null }),
  areaTextRequest: null,
  requestAreaText: (selection) =>
    set({ areaTextRequest: { ...selection, token: Date.now() }, selection: null, mode: get().mode === "areaText" ? null : get().mode }),
  clearAreaText: () => set({ areaTextRequest: null }),
  snapshotRequest: null,
  requestSnapshot: (selection) =>
    set({ snapshotRequest: { ...selection, token: Date.now() }, selection: null, mode: get().mode === "snapshot" ? null : get().mode }),
  clearSnapshot: () => set({ snapshotRequest: null }),
  past: [],
  future: [],
  snapshot: () => set({ past: [...get().past.slice(-49), get().objects], future: [] }),
  undo: () => {
    const past = get().past;
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({ past: past.slice(0, -1), future: [get().objects, ...get().future], objects: previous, selectedObjectId: null, editingObjectId: null });
  },
  redo: () => {
    const future = get().future;
    if (future.length === 0) return;
    const next = future[0];
    set({ future: future.slice(1), past: [...get().past, get().objects], objects: next, selectedObjectId: null, editingObjectId: null });
  },
  setMode: (mode) => {
    const keepObjects = mode !== null && EDITOR_MODES.includes(mode) && get().mode !== null && EDITOR_MODES.includes(get().mode as OverlayMode);
    set({ mode, selection: null, measure: null, placement: null, areaTextRequest: null, editingObjectId: null, selectedObjectId: keepObjects ? get().selectedObjectId : null, objects: keepObjects || mode === null ? get().objects : [] });
    if (mode === null) set({ objects: [], pendingImage: null, drawingEditor: null, spansByPage: {}, blocksByPage: {}, hiddenLayerKeys: {}, lockedLayerKeys: {}, fontFamilies: {}, imagePreviews: {}, warnings: [], fontResolutions: {}, focusRequest: null, past: [], future: [], clipboard: null });
  },
  setSelection: (selection) => set({ selection }),
  addMeasurePoint: (pageIndex, point) => {
    const current = get().measure;
    if (!current || current.pageIndex !== pageIndex || current.points.length >= 2) {
      set({ measure: { pageIndex, points: [point] } });
      return;
    }
    set({ measure: { pageIndex, points: [...current.points, point] } });
  },
  resetMeasure: () => set({ measure: null }),
  setScaleDenominator: (value) => set({ scaleDenominator: Number.isFinite(value) && value > 0 ? value : 1 }),
  setUnit: (unit) => set({ unit }),
  setSignatureId: (id) => set({ signatureId: id }),
  setSignatureWidthMm: (value) => set({ signatureWidthMm: Math.min(200, Math.max(10, value)) }),
  setPlacement: (placement) => set({ placement }),
  addObject: (object) => set({ objects: [...get().objects, object], selectedObjectId: object.id }),
  updateObject: (id, patch) => set({ objects: get().objects.map((item) => (item.id === id ? ({ ...item, ...patch } as EditorPending) : item)) }),
  removeObject: (id) => set({ objects: get().objects.filter((item) => item.id !== id), selectedObjectId: get().selectedObjectId === id ? null : get().selectedObjectId, editingObjectId: get().editingObjectId === id ? null : get().editingObjectId }),
  clearObjects: () => set({ objects: [], selectedObjectId: null, editingObjectId: null, spansByPage: {}, blocksByPage: {}, hiddenLayerKeys: {}, lockedLayerKeys: {}, fontFamilies: {}, imagePreviews: {}, fontResolutions: {}, focusRequest: null, past: [], future: [], clipboard: null }),
  setSelectedObject: (id) => set({ selectedObjectId: id }),
  setEditingObject: (id) => set({ editingObjectId: id, selectedObjectId: id ?? get().selectedObjectId }),
  setTextStyle: (patch) => {
    const textStyle = { ...get().textStyle, ...patch };
    const selected = get().selectedObjectId;
    set({
      textStyle,
      objects: get().objects.map((item) => (item.id === selected && (item.kind === "text" || item.kind === "edit" || item.kind === "block") ? withStylePatch(item, patch) : item)),
    });
  },
  setPendingImage: (image) => set({ pendingImage: image }),
  clipboard: null,
  copyObject: (object) => set({ clipboard: { object, pageIndex: object.pageIndex } }),
  pasteObject: (targetPageIndex, pageWidth, pageHeight) => {
    const clipboard = get().clipboard;
    if (!clipboard) return;
    const position = pastePosition(clipboard.object, clipboard.pageIndex, targetPageIndex, pageWidth, pageHeight);
    get().snapshot();
    const pasted = toPastedObject(clipboard.object, get().imagePreviews, clipboard.pageIndex, targetPageIndex, position.x, position.y);
    get().addObject(pasted);
  },
  leaveNext: null,
  requestLeave: (next, hasPending) => {
    if (hasPending) {
      set({ leaveNext: next });
      return false;
    }
    next();
    return true;
  },
  cancelLeave: () => set({ leaveNext: null }),
}));
