import i18n from "@/app/i18n";
import type { DrawingKind } from "@/features/viewer/overlay/drawing/drawingSource";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerOverlayStore, type EditorPending, type PendingImage } from "@/shared/store/viewerOverlayStore";
import { resizedDrawing } from "./drawingPlacement";

export const MAX_DRAWING_DATA_URL = 4_000_000;
const PROXY_PREFIX = "presentation:";

type OverlayState = ReturnType<typeof useViewerOverlayStore.getState>;
type Target = { pageIndex: number; strokeId: string; proxyId: string; past: OverlayState["past"]; future: OverlayState["future"] };

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
  const stroke = presentation.strokesByPage[current.pageIndex]?.find((entry) => entry.id === current.strokeId);
  if (!stroke) return;
  const id = presentation.addDrawingAsset({ dataUrl: after.dataUrl, width: after.width, height: after.height, drawing: after.drawing });
  presentation.replaceDrawing(current.pageIndex, resizedDrawing(stroke, id, after.width / before.width, after.height / before.height));
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

export function editPresentationDrawing(pageIndex: number, stroke: Stroke): void {
  const overlay = useViewerOverlayStore.getState();
  const asset = stroke.asset ? usePresentationStore.getState().drawingAssets[stroke.asset] : undefined;
  if (!asset?.drawing || overlay.mode !== null || asset.width <= 0 || asset.height <= 0) return;
  if (overlay.drawingEditor) overlay.closeDrawingEditor();
  listen();
  const proxyId = `${PROXY_PREFIX}${stroke.id}`;
  const proxy: EditorPending = { id: proxyId, kind: "image", pageIndex, x: 0, y: 0, width: asset.width, height: asset.height, dataUrl: asset.dataUrl, path: null, aspect: asset.width / asset.height, opacity: 1, drawing: asset.drawing };
  const current = useViewerOverlayStore.getState();
  target = { pageIndex, strokeId: stroke.id, proxyId, past: current.past, future: current.future };
  active = true;
  useViewerOverlayStore.setState({ objects: [...current.objects.filter((item) => item.id !== proxyId), proxy] });
  useViewerOverlayStore.getState().openDrawingEditor(asset.drawing.kind, proxyId);
}

export function isPresentationDrawingOpen(): boolean {
  return active;
}
