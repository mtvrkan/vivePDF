import i18n from "@/app/i18n";
import type { DrawingKind, DrawingSource } from "@/features/viewer/overlay/drawing/drawingSource";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { presentationInsertedSources } from "@/shared/rpc/operations";
import { usePresentationStore, type DrawingSurface, type Stroke, type StrokePoint } from "@/shared/store/presentationStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerOverlayStore, type EditorPending, type PendingImage } from "@/shared/store/viewerOverlayStore";
import type { PresentationInsertedItem } from "@/types";
import { makeDrawingId } from "./drawingGestures";
import { resizedDrawing } from "./drawingPlacement";
import { drawingOfInserted, insertedItemAt } from "./insertedSource";

export const MAX_DRAWING_DATA_URL = 4_000_000;
const PROXY_PREFIX = "presentation:";

type OverlayState = ReturnType<typeof useViewerOverlayStore.getState>;
type SavedStamp = { item: PresentationInsertedItem; remove: () => void };
type Target = { surface: DrawingSurface; strokeId: string; proxyId: string; past: OverlayState["past"]; future: OverlayState["future"]; stamp?: SavedStamp };

export type SavedStamps = { path: string; password?: string; exists: (id: string) => boolean; remove: (pageIndex: number, id: string) => void };

let active = false;
let target: Target | null = null;
let unsubscribe: (() => void) | null = null;

function imageOf(objects: EditorPending[], id: string) {
  const found = objects.find((item) => item.id === id);
  return found?.kind === "image" ? found : null;
}

function tooLarge(): void {
  useToastStore.getState().push("error", i18n.t("presentation.insert.tooLarge"));
}

function accept(image: PendingImage): void {
  if (!image.drawing || image.width <= 0 || image.height <= 0) return;
  if (image.dataUrl.length > MAX_DRAWING_DATA_URL) {
    tooLarge();
    return;
  }
  const presentation = usePresentationStore.getState();
  const id = presentation.addDrawingAsset({ dataUrl: image.dataUrl, width: image.width, height: image.height, drawing: image.drawing });
  presentation.armPlacement(id);
}

function rewrite(current: Target, before: Extract<EditorPending, { kind: "image" }>, after: Extract<EditorPending, { kind: "image" }>): void {
  if (!after.drawing || before.width <= 0 || before.height <= 0) return;
  if (after.dataUrl.length > MAX_DRAWING_DATA_URL) {
    tooLarge();
    return;
  }
  const presentation = usePresentationStore.getState();
  if (current.stamp && typeof current.surface === "number") {
    replaceStamp(current, current.surface, current.stamp, before, after);
    return;
  }
  const strokes = typeof current.surface === "number" ? presentation.strokesByPage[current.surface] : presentation.boardStrokes[current.surface];
  const stroke = strokes?.find((entry) => entry.id === current.strokeId);
  if (!stroke) return;
  const id = presentation.addDrawingAsset({ dataUrl: after.dataUrl, width: after.width, height: after.height, drawing: after.drawing });
  presentation.replaceDrawing(current.surface, resizedDrawing(stroke, id, after.width / before.width, after.height / before.height));
}

function replaceStamp(current: Target, pageIndex: number, stamp: SavedStamp, before: Extract<EditorPending, { kind: "image" }>, after: Extract<EditorPending, { kind: "image" }>): void {
  if (!after.drawing) return;
  const presentation = usePresentationStore.getState();
  const [x0, y0, x1, y1] = stamp.item.rect;
  const id = presentation.addDrawingAsset({ dataUrl: after.dataUrl, width: after.width, height: after.height, drawing: after.drawing });
  const base: Stroke = { id: makeDrawingId("drawing"), tool: "drawing", color: "#000000", width: 0, points: [{ x: x0, y: y0 }], size: { width: x1 - x0, height: y1 - y0 }, asset: id };
  const stroke = resizedDrawing(base, id, after.width / before.width, after.height / before.height);
  presentation.addStroke(pageIndex, stroke);
  stamp.remove();
  target = { ...current, strokeId: stroke.id, stamp: undefined };
}

function finish(): void {
  const current = target;
  active = false;
  target = null;
  if (!current) return;
  const overlay = useViewerOverlayStore.getState();
  useViewerOverlayStore.setState({ objects: overlay.objects.filter((item) => item.id !== current.proxyId), past: current.past, future: current.future });
}

function onOverlayChange(state: OverlayState, previous: OverlayState): void {
  if (!active) return;
  const image = state.pendingImage;
  if (!target && image && image !== previous.pendingImage && image.drawing) {
    useViewerOverlayStore.getState().setPendingImage(null);
    accept(image);
  }
  if (target && state.objects !== previous.objects) {
    const before = imageOf(previous.objects, target.proxyId);
    const after = imageOf(state.objects, target.proxyId);
    if (before && after && before !== after) rewrite(target, before, after);
  }
  if (!state.drawingEditor && previous.drawingEditor) finish();
}

function listen(): void {
  unsubscribe ??= useViewerOverlayStore.subscribe(onOverlayChange);
}

export function canInsertDrawing(): boolean {
  return useViewerOverlayStore.getState().mode === null;
}

export function openPresentationDrawing(kind: DrawingKind): void {
  const overlay = useViewerOverlayStore.getState();
  if (overlay.mode !== null) return;
  if (overlay.drawingEditor) overlay.closeDrawingEditor();
  listen();
  active = true;
  target = null;
  useViewerOverlayStore.getState().openDrawingEditor(kind, null);
}

function openEditor(surface: DrawingSurface, key: string, picture: { dataUrl: string; width: number; height: number; drawing: DrawingSource }, stamp?: SavedStamp): void {
  const overlay = useViewerOverlayStore.getState();
  if (overlay.drawingEditor) overlay.closeDrawingEditor();
  listen();
  const proxyId = `${PROXY_PREFIX}${key}`;
  const proxy: EditorPending = { id: proxyId, kind: "image", pageIndex: typeof surface === "number" ? surface : 0, x: 0, y: 0, width: picture.width, height: picture.height, dataUrl: picture.dataUrl, path: null, aspect: picture.width / picture.height, opacity: 1, drawing: picture.drawing };
  const current = useViewerOverlayStore.getState();
  target = { surface, strokeId: key, proxyId, past: current.past, future: current.future, ...(stamp ? { stamp } : {}) };
  active = true;
  useViewerOverlayStore.setState({ objects: [...current.objects.filter((item) => item.id !== proxyId), proxy] });
  useViewerOverlayStore.getState().openDrawingEditor(picture.drawing.kind, proxyId);
}

export function editPresentationDrawing(surface: DrawingSurface, stroke: Stroke): void {
  const overlay = useViewerOverlayStore.getState();
  const asset = stroke.asset ? usePresentationStore.getState().drawingAssets[stroke.asset] : undefined;
  if (!asset?.drawing || overlay.mode !== null || asset.width <= 0 || asset.height <= 0) return;
  openEditor(surface, stroke.id, { dataUrl: asset.dataUrl, width: asset.width, height: asset.height, drawing: asset.drawing });
}

export async function editSavedPresentationDrawing(pageIndex: number, point: StrokePoint, stamps: SavedStamps): Promise<boolean> {
  if (useViewerOverlayStore.getState().mode !== null) return false;
  let items: PresentationInsertedItem[];
  try {
    items = (await presentationInsertedSources({ path: stamps.path, password: stamps.password, page: pageIndex + 1 })).items;
  } catch (caught) {
    useToastStore.getState().push("error", describeError(i18n.t, toRpcError(caught)));
    return false;
  }
  const item = insertedItemAt(
    items.filter((entry) => stamps.exists(entry.id)),
    point,
  );
  const drawing = item ? drawingOfInserted(item) : null;
  if (!item || !drawing || useViewerOverlayStore.getState().mode !== null) return false;
  const { width, height } = drawing.source;
  openEditor(pageIndex, item.id, { dataUrl: "", width, height, drawing }, { item, remove: () => stamps.remove(pageIndex, item.id) });
  return true;
}

export function isPresentationDrawingOpen(): boolean {
  return active;
}
