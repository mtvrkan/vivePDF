import { useEffect, useReducer, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Move } from "lucide-react";
import { useTranslation } from "react-i18next";
import { editorBlocks, imageAt, imagePreview } from "@/shared/rpc/operations";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useSignatureStore } from "@/shared/store/signatureStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useDropPositionHandler } from "@/shared/hooks/useDropHandler";
import { EDITOR_MODES, useViewerOverlayStore, type BlockRun, type EditorPending, type PagePoint, type RunStyle } from "@/shared/store/viewerOverlayStore";
import { useUiStore } from "@/shared/store/uiStore";
import { formatLength, measureDistance } from "./measure";
import { pageTurns, visiblePageSize } from "./pageSize";
import { frameSizePx, frameToScreen, frameTransform, screenToFrame, viewTurnsOf } from "./pageFrame";
import { isUsableArea } from "./areaText";
import { BlockEditor } from "./BlockEditor";
import { FitText } from "./FitText";
import { fontFileKey, loadBlockFonts, loadFontFile } from "./embeddedFonts";
import { decideDropAction, dropHitKindFor } from "./dropRouting";
import { imageChangeFromBlock, replaceImageAt, replaceImageWithDialog } from "./imageReplace";
import { fontStackFor, fontStackForRun, isPendingChange, rectChanged, runCss } from "./pending";
import { flattenLines, hasMixedStyles, textOf } from "./runs";
import { renderRuns, type RunStyler } from "./runRender";
import { contrastingBackground, sampleBackground } from "./sampleBackground";
import { pageMarginCandidates, rectEdgeCandidates, snapValue } from "./snap";
import { computeSnappedRect } from "./snapIntegration";
import { SnapGuides } from "./SnapGuides";
import { ObjectToolbar } from "./ObjectToolbar";
import { pickLayerHit, type HitKind, type HitSource } from "./hitTest";
import { layerKey } from "./layers";
import { isDrawingImage } from "./drawing/drawingSource";
import type { EditorBlockInfo, EditorImageBlock, EditorTextBlock } from "@/types";

const MM_TO_PT = 72 / 25.4;
const MIN_OBJECT_SIZE = 12;
const DEFAULT_TEXT_WIDTH = 220;
const DEFAULT_IMAGE_WIDTH = 160;
const BLOCK_TOLERANCE = 2;
const SNAP_TOLERANCE_PX = 4;
const PREVIEW_MAX_SIDE = 1024;
const HANDLE_CLASS = "absolute size-3 rounded-sm border border-white bg-primary shadow-sm";

type LayerProps = { documentId: string; pageIndex: number; width: number; height: number };
type BlockPending = Extract<EditorPending, { kind: "block" }>;
type ImageChangePending = Extract<EditorPending, { kind: "imageChange" }>;
type Drag =
  | { kind: "select"; start: PagePoint }
  | { kind: "move"; offset: PagePoint }
  | { kind: "object-move"; id: string; offset: PagePoint; moved: boolean }
  | { kind: "object-resize"; id: string; start: PagePoint; width: number; height: number; aspect: number | null; axis: "x" | "xy" };

function blockArea(block: EditorBlockInfo): number {
  return (block.bbox[2] - block.bbox[0]) * (block.bbox[3] - block.bbox[1]);
}

function imagePreviewKey(pageIndex: number, xref: number): string {
  return `${pageIndex}:${xref}`;
}

function objectHitKind(item: EditorPending): HitKind {
  return item.kind === "image" || item.kind === "imageChange" ? "image" : "text";
}

function objectHitRect(item: EditorPending): { x: number; y: number; width: number; height: number } {
  return item.kind === "imageChange" && item.deleted ? item.original : { x: item.x, y: item.y, width: item.width, height: item.height };
}

function backgroundKey(item: BlockPending): string {
  const rect = item.originalRect;
  return `${item.id}|${rect.x}|${rect.y}|${rect.width}|${rect.height}`;
}

export function PageOverlayLayer({ documentId, pageIndex, width, height }: LayerProps) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const mode = useViewerOverlayStore((state) => state.mode);
  const selection = useViewerOverlayStore((state) => state.selection);
  const measure = useViewerOverlayStore((state) => state.measure);
  const placement = useViewerOverlayStore((state) => state.placement);
  const signatureId = useViewerOverlayStore((state) => state.signatureId);
  const signatureWidthMm = useViewerOverlayStore((state) => state.signatureWidthMm);
  const scaleDenominator = useViewerOverlayStore((state) => state.scaleDenominator);
  const unit = useViewerOverlayStore((state) => state.unit);
  const objects = useViewerOverlayStore((state) => state.objects);
  const selectedObjectId = useViewerOverlayStore((state) => state.selectedObjectId);
  const editingObjectId = useViewerOverlayStore((state) => state.editingObjectId);
  const textStyle = useViewerOverlayStore((state) => state.textStyle);
  const pendingImage = useViewerOverlayStore((state) => state.pendingImage);
  const blocks = useViewerOverlayStore((state) => state.blocksByPage[pageIndex]);
  const hiddenLayerKeys = useViewerOverlayStore((state) => state.hiddenLayerKeys);
  const lockedLayerKeys = useViewerOverlayStore((state) => state.lockedLayerKeys);
  const hoveredLayerKey = useViewerOverlayStore((state) => state.hoveredLayerKey);
  const fontFamilies = useViewerOverlayStore((state) => state.fontFamilies);
  const imagePreviews = useViewerOverlayStore((state) => state.imagePreviews);
  const fontResolutions = useViewerOverlayStore((state) => state.fontResolutions);
  const focusRequest = useViewerOverlayStore((state) => state.focusRequest);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const [hoverBlock, setHoverBlock] = useState<EditorBlockInfo | null>(null);
  const signature = useSignatureStore((state) => state.items.find((item) => item.id === signatureId) ?? null);
  const locale = useUiStore((state) => state.locale);
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [, noteRelease] = useReducer((count: number) => count + 1, 0);
  const caretRef = useRef<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<PagePoint | null>(null);
  const [backgrounds, setBackgrounds] = useState<Record<string, string>>({});
  const [snapGuides, setSnapGuides] = useState<{ x: number[]; y: number[] } | null>(null);

  const editorActive = mode !== null && EDITOR_MODES.includes(mode);

  const pageObjects = objects.filter((item) => item.pageIndex === pageIndex && !hiddenLayerKeys[layerKey(pageIndex, item.id)]);
  const claimedBlocks = new Set(pageObjects.flatMap((item) => (item.kind === "block" || item.kind === "imageChange" ? [item.blockId] : [])));
  const visibleBlocks = (blocks ?? []).filter((block) => !claimedBlocks.has(block.id) && !hiddenLayerKeys[layerKey(pageIndex, block.id)]);
  const modeHitKind: HitKind | null = mode === "text" ? "text" : mode === "image" ? "image" : null;

  const hitAt = (point: PagePoint, pageArea: number, allowedKind: HitKind | null): { source: "object"; item: EditorPending } | { source: "block"; block: EditorBlockInfo } | null => {
    const objectSources: HitSource<EditorPending>[] = [...pageObjects].reverse().map((item) => ({ id: item.id, kind: objectHitKind(item), rect: objectHitRect(item), value: item }));
    const blockSources: HitSource<EditorBlockInfo>[] = visibleBlocks.map((block) => ({ id: block.id, kind: block.kind, rect: { x: block.bbox[0], y: block.bbox[1], width: block.bbox[2] - block.bbox[0], height: block.bbox[3] - block.bbox[1] }, value: block }));
    const hit = pickLayerHit(point, objectSources, blockSources, pageArea, BLOCK_TOLERANCE, allowedKind);
    if (!hit) return null;
    return hit.source === "object" ? { source: "object", item: hit.value } : { source: "block", block: hit.value };
  };

  const handleImageDrop = (paths: string[], position: { x: number; y: number }): boolean => {
    if (!editorActive || !document) return false;
    const files = paths.map((path) => ({ name: path.split(/[\\/]/).pop() ?? path }));
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const page = visiblePageSize(documentId, pageIndex, width, height);
    const scale = frameSizePx(pageTurns(documentId, pageIndex), width, height).width / page.width;
    const local = screenToFrame(position.x / window.devicePixelRatio, position.y / window.devicePixelRatio, rect, viewTurnsOf(layerRef.current));
    const rawX = local.x / scale;
    const rawY = local.y / scale;
    const point: PagePoint = { x: Math.min(page.width, Math.max(0, rawX)), y: Math.min(page.height, Math.max(0, rawY)) };
    const insidePage = rawX >= 0 && rawX <= page.width && rawY >= 0 && rawY <= page.height;
    const hit = insidePage ? hitAt(point, page.width * page.height, null) : null;
    const hitObject = hit?.source === "object" ? hit.item : null;
    const hitBlock = hit?.source === "block" ? hit.block : null;
    const hitKind = dropHitKindFor(hit ? (hit.source === "object" ? { source: "object", kind: hit.item.kind } : { source: "block", kind: hit.block.kind }) : null, insidePage);
    const action = decideDropAction(mode ?? "", files, hitKind);
    if (action === "replaceImage") {
      const path = paths[0];
      if (hitObject && hitObject.kind === "imageChange") {
        void replaceImageAt(hitObject, path);
      } else if (hitObject && hitObject.kind === "image") {
        void imagePreview({ path }).then((preview) => {
          const activeStore = useViewerOverlayStore.getState();
          activeStore.snapshot();
          activeStore.updateObject(hitObject.id, { dataUrl: `data:image/png;base64,${preview.pngBase64}`, path, aspect: preview.width / preview.height, drawing: undefined });
        });
      } else if (hitBlock && hitBlock.kind === "image") {
        const newItem = imageChangeFromBlock(hitBlock, pageIndex);
        const activeStore = useViewerOverlayStore.getState();
        activeStore.snapshot();
        activeStore.addObject(newItem);
        void replaceImageAt(newItem, path);
      } else {
        return false;
      }
      return true;
    }
    if (action === "createImage") {
      void imagePreview({ path: paths[0] }).then((preview) => {
        const aspect = preview.width / preview.height;
        const objectWidth = Math.min(DEFAULT_IMAGE_WIDTH, page.width - 4);
        const objectHeight = objectWidth / aspect;
        const activeStore = useViewerOverlayStore.getState();
        activeStore.snapshot();
        activeStore.addObject({ id: crypto.randomUUID(), kind: "image", pageIndex, x: Math.max(0, point.x - objectWidth / 2), y: Math.max(0, point.y - objectHeight / 2), width: objectWidth, height: objectHeight, dataUrl: `data:image/png;base64,${preview.pngBase64}`, path: paths[0], aspect, opacity: 1 });
      });
      return true;
    }
    return false;
  };

  useDropPositionHandler(editorActive ? handleImageDrop : null);

  useEffect(() => {
    if (!editorActive || blocks !== undefined || !document) return;
    let cancelled = false;
    void editorBlocks({ path: document.path, password: document.password ?? undefined, page: pageIndex })
      .then((result) => {
        if (cancelled) return;
        useViewerOverlayStore.getState().setBlocks(pageIndex, result.blocks);
        for (const block of result.blocks) if (block.kind === "text") loadBlockFonts(document, block);
      })
      .catch(() => {
        if (!cancelled) useViewerOverlayStore.getState().setBlocks(pageIndex, []);
      });
    return () => {
      cancelled = true;
    };
  }, [editorActive, blocks, document, pageIndex]);

  useEffect(() => {
    if (!editorActive) return;
    for (const item of objects) {
      if (item.pageIndex !== pageIndex) continue;
      if (item.kind === "text" && item.style.fontId) void loadFontFile(item.style.fontId, item.style.bold);
      const resolution = item.kind === "block" ? fontResolutions[item.id] : undefined;
      if (resolution?.source === "system" && resolution.fontId) void loadFontFile(resolution.fontId, false);
    }
  }, [editorActive, objects, pageIndex, fontResolutions]);

  useEffect(() => {
    if (!focusRequest || focusRequest.page !== pageIndex + 1) return;
    const state = useViewerOverlayStore.getState();
    const pageBlocks = state.blocksByPage[pageIndex];
    if (!pageBlocks) return;
    const claimed = new Set(
      state.objects
        .filter((item) => item.pageIndex === pageIndex && (item.kind === "block" || item.kind === "imageChange"))
        .map((item) => (item as { blockId: string }).blockId),
    );
    let best: EditorBlockInfo | null = null;
    for (const block of pageBlocks) {
      if (claimed.has(block.id)) continue;
      const [x0, y0, x1, y1] = block.bbox;
      if (focusRequest.x < x0 || focusRequest.x > x1 || focusRequest.y < y0 || focusRequest.y > y1) continue;
      if (!best || blockArea(block) < blockArea(best)) best = block;
    }
    state.clearFocusRequest();
    if (!best) return;
    if (best.kind === "text") {
      const id = crypto.randomUUID();
      const [bx0, by0, bx1, by1] = best.bbox;
      const style = { fontSize: best.size, color: best.color, bold: best.bold, italic: best.italic, font: best.font, align: best.align, lineHeight: best.lineHeight };
      const rect = { x: bx0, y: by0, width: Math.max(bx1 - bx0, 12), height: Math.max(by1 - by0, best.size * best.lineHeight) };
      state.snapshot();
      state.addObject({
        id,
        kind: "block",
        pageIndex,
        blockId: best.id,
        ...rect,
        text: textOf(flattenLines(best.textLines)),
        original: textOf(flattenLines(best.textLines)),
        originalRect: { ...rect },
        style,
        originalStyle: { ...style },
        fontXref: best.fontXref,
        fontExt: best.fontExt,
        fontFamily: best.fontFamily,
        runs: flattenLines(best.textLines),
        originalRuns: flattenLines(best.textLines),
        firstLineIndent: best.firstLineIndent,
        leading: best.leading,
        rotated: best.rotated,
        fittedSize: null,
        opacity: 1,
      });
      state.setSelectedObject(id);
    } else {
      const created = imageChangeFromBlock(best, pageIndex);
      state.snapshot();
      state.addObject(created);
      state.setSelectedObject(created.id);
    }
  }, [focusRequest, pageIndex, blocks]);

  useEffect(() => {
    if (!editorActive) return;
    const layer = layerRef.current;
    if (!layer) return;
    const currentPage = visiblePageSize(documentId, pageIndex, width, height);
    const currentTurns = pageTurns(documentId, pageIndex);
    const currentScale = frameSizePx(currentTurns, width, height).width / currentPage.width;
    const blocksNeeding = objects.filter((item): item is BlockPending => item.pageIndex === pageIndex && item.kind === "block");
    const validKeys = new Set(blocksNeeding.map(backgroundKey));
    const additions: Record<string, string> = {};
    for (const item of blocksNeeding) {
      const key = backgroundKey(item);
      if (key in backgrounds) continue;
      const sampled = sampleBackground(layer.parentElement, { left: item.originalRect.x * currentScale, top: item.originalRect.y * currentScale, width: item.originalRect.width * currentScale, height: item.originalRect.height * currentScale }, currentTurns);
      if (sampled) additions[key] = sampled;
    }
    const stale = Object.keys(backgrounds).some((key) => !validKeys.has(key));
    if (Object.keys(additions).length === 0 && !stale) return;
    setBackgrounds((current) => {
      const pruned = Object.fromEntries(Object.entries(current).filter(([key]) => validKeys.has(key)));
      return { ...pruned, ...additions };
    });
  }, [objects, pageIndex, documentId, width, height, editorActive, backgrounds]);

  if (!mode) return null;

  const page = visiblePageSize(documentId, pageIndex, width, height);
  const turns = pageTurns(documentId, pageIndex);
  const frame = frameSizePx(turns, width, height);
  const scale = frame.width / page.width;
  const toPage = (event: ReactMouseEvent): PagePoint => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const local = screenToFrame(event.clientX, event.clientY, rect, viewTurnsOf(layerRef.current));
    return { x: Math.min(page.width, Math.max(0, local.x / scale)), y: Math.min(page.height, Math.max(0, local.y / scale)) };
  };
  const px = (value: number) => value * scale;
  const store = useViewerOverlayStore.getState();
  const isEditor = EDITOR_MODES.includes(mode);
  const usesSelection = mode === "crop" || mode === "redact" || mode === "link" || mode === "measure" || mode === "areaText" || mode === "snapshot";

  const signatureWidthPt = signatureWidthMm * MM_TO_PT;
  const signatureHeightPt = signature ? (signatureWidthPt * signature.height) / signature.width : 0;
  const placementRect =
    placement && placement.pageIndex === pageIndex && signature
      ? { x0: placement.x - signatureWidthPt / 2, y0: placement.y - signatureHeightPt / 2, x1: placement.x + signatureWidthPt / 2, y1: placement.y + signatureHeightPt / 2 }
      : null;

  const finishEditing = () => {
    const editing = objects.find((item) => item.id === editingObjectId);
    store.setEditingObject(null);
    if (!editing) return;
    if (editing.kind === "text" && !editing.text.trim()) store.removeObject(editing.id);
    if (editing.kind === "block" && !isPendingChange(editing)) store.removeObject(editing.id);
  };

  const pruneUnchangedImages = (keepId: string | null) => {
    for (const item of pageObjects) if (item.kind === "imageChange" && item.id !== keepId && !isPendingChange(item)) store.removeObject(item.id);
  };

  const objectAt = (point: PagePoint): EditorPending | null => {
    const resolved = hitAt(point, page.width * page.height, modeHitKind);
    return resolved?.source === "object" ? resolved.item : null;
  };

  const blockAt = (point: PagePoint): EditorBlockInfo | null => {
    const resolved = hitAt(point, page.width * page.height, modeHitKind);
    return resolved?.source === "block" ? resolved.block : null;
  };

  const isLocked = (id: string) => Boolean(lockedLayerKeys[layerKey(pageIndex, id)]);

  const adoptTextBlock = (block: EditorTextBlock, event: ReactMouseEvent) => {
    const id = crypto.randomUUID();
    const [x0, y0, x1, y1] = block.bbox;
    const style = { fontSize: block.size, color: block.color, bold: block.bold, italic: block.italic, font: block.font, align: block.align, lineHeight: block.lineHeight };
    const rect = { x: x0, y: y0, width: Math.max(x1 - x0, 12), height: Math.max(y1 - y0, block.size * block.lineHeight) };
    store.snapshot();
    store.addObject({
      id,
      kind: "block",
      pageIndex,
      blockId: block.id,
      ...rect,
      text: textOf(flattenLines(block.textLines)),
      original: textOf(flattenLines(block.textLines)),
      originalRect: { ...rect },
      style,
      originalStyle: { ...style },
      fontXref: block.fontXref,
      fontExt: block.fontExt,
      fontFamily: block.fontFamily,
      runs: flattenLines(block.textLines),
      originalRuns: flattenLines(block.textLines),
      firstLineIndent: block.firstLineIndent,
      leading: block.leading,
      rotated: block.rotated,
      fittedSize: null,
      opacity: 1,
    });
    caretRef.current = { x: event.clientX, y: event.clientY };
    store.setEditingObject(id);
    if (document) loadBlockFonts(document, block);
  };

  const adoptImageBlock = (block: EditorImageBlock, point: PagePoint) => {
    const created = imageChangeFromBlock(block, pageIndex);
    const rect = { x: created.x, y: created.y, width: created.width, height: created.height };
    store.snapshot();
    store.addObject(created);
    dragRef.current = { kind: "object-move", id: created.id, offset: { x: point.x - rect.x, y: point.y - rect.y }, moved: false };
    const key = imagePreviewKey(pageIndex, block.xref);
    if (document && !imagePreviews[key]) {
      void imageAt({ path: document.path, password: document.password ?? undefined, page: pageIndex + 1, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, previewMaxSide: PREVIEW_MAX_SIDE })
        .then((result) => {
          if (result.found && result.xref === block.xref && result.pngBase64) useViewerOverlayStore.getState().setImagePreview(key, `data:image/png;base64,${result.pngBase64}`);
        })
        .catch(() => undefined);
    }
  };

  const snapCandidateRects = (excludeId: string) => {
    const objectRects = pageObjects.filter((entry) => entry.id !== excludeId).map((entry) => ({ x: entry.x, y: entry.y, width: entry.width, height: entry.height }));
    const blockRects = (blocks ?? []).filter((block) => !claimedBlocks.has(block.id)).map((block) => ({ x: block.bbox[0], y: block.bbox[1], width: block.bbox[2] - block.bbox[0], height: block.bbox[3] - block.bbox[1] }));
    return [...objectRects, ...blockRects];
  };

  const startObjectMove = (item: EditorPending, point: PagePoint) => {
    store.setSelectedObject(item.id);
    dragRef.current = { kind: "object-move", id: item.id, offset: { x: point.x - item.x, y: point.y - item.y }, moved: false };
  };

  const onMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-editor-input]")) return;
    event.preventDefault();
    event.stopPropagation();
    const point = toPage(event);
    const handle = target.closest<HTMLElement>("[data-resize-handle]");
    if (handle?.dataset.resizeHandle) {
      const item = pageObjects.find((entry) => entry.id === handle.dataset.resizeHandle);
      if (item && !isLocked(item.id)) {
        store.snapshot();
        const freeAspect = event.shiftKey;
        const aspect = (item.kind === "image" || item.kind === "imageChange") && !freeAspect ? item.aspect : null;
        if (item.kind === "imageChange") store.updateObject(item.id, { aspectLocked: !freeAspect });
        dragRef.current = { kind: "object-resize", id: item.id, start: point, width: item.width, height: item.height, aspect, axis: handle.dataset.axis === "x" ? "x" : "xy" };
        store.setSelectedObject(item.id);
      }
      return;
    }
    const grip = target.closest<HTMLElement>("[data-move-handle]");
    if (grip?.dataset.moveHandle) {
      const item = pageObjects.find((entry) => entry.id === grip.dataset.moveHandle);
      if (item && !isLocked(item.id)) {
        if (editingObjectId === item.id) store.setEditingObject(null);
        startObjectMove(item, point);
      }
      return;
    }
    if (isEditor) {
      const editing = editingObjectId ? pageObjects.find((entry) => entry.id === editingObjectId) : null;
      if (editing && point.x >= editing.x && point.x <= editing.x + editing.width && point.y >= editing.y && point.y <= editing.y + editing.height) return;
      if (editingObjectId) finishEditing();
      const hit = objectAt(point);
      pruneUnchangedImages(hit?.id ?? null);
      if (hit) {
        store.setSelectedObject(hit.id);
        if (isLocked(hit.id)) return;
        if (hit.kind === "block" || hit.kind === "edit") {
          caretRef.current = { x: event.clientX, y: event.clientY };
          store.setEditingObject(hit.id);
          return;
        }
        if (hit.kind === "imageChange" && hit.deleted) return;
        startObjectMove(hit, point);
        return;
      }
      const block = blockAt(point);
      if (block) {
        setHoverBlock(null);
        if (block.kind === "text") adoptTextBlock(block, event);
        else adoptImageBlock(block, point);
        return;
      }
      if (mode === "text") {
        const id = crypto.randomUUID();
        const objectHeight = textStyle.fontSize * 1.8;
        store.snapshot();
        store.addObject({ id, kind: "text", pageIndex, x: point.x, y: Math.max(0, point.y - objectHeight / 2), width: Math.min(DEFAULT_TEXT_WIDTH, page.width - point.x), height: objectHeight, text: "", style: { ...textStyle }, opacity: 1 });
        caretRef.current = null;
        store.setEditingObject(id);
        return;
      }
      if (mode === "image" && pendingImage) {
        const aspect = pendingImage.width / pendingImage.height;
        const objectWidth = Math.min(pendingImage.drawing ? pendingImage.width : DEFAULT_IMAGE_WIDTH, page.width - 4);
        const objectHeight = objectWidth / aspect;
        store.snapshot();
        store.addObject({ id: crypto.randomUUID(), kind: "image", pageIndex, x: Math.max(0, point.x - objectWidth / 2), y: Math.max(0, point.y - objectHeight / 2), width: objectWidth, height: objectHeight, dataUrl: pendingImage.dataUrl, path: pendingImage.path, aspect, opacity: 1, ...(pendingImage.drawing ? { drawing: pendingImage.drawing } : {}) });
        if (pendingImage.drawing) store.setPendingImage(null);
        return;
      }
      store.setSelectedObject(null);
      return;
    }
    if (mode === "measure") {
      store.addMeasurePoint(pageIndex, point);
      return;
    }
    if (usesSelection) {
      dragRef.current = { kind: "select", start: point };
      store.setSelection({ pageIndex, x0: point.x, y0: point.y, x1: point.x, y1: point.y });
      return;
    }
    if (mode === "signature" && signature) {
      if (placementRect && point.x >= placementRect.x0 && point.x <= placementRect.x1 && point.y >= placementRect.y0 && point.y <= placementRect.y1 && placement) {
        dragRef.current = { kind: "move", offset: { x: point.x - placement.x, y: point.y - placement.y } };
        return;
      }
      store.setPlacement({ pageIndex, x: point.x, y: point.y });
    }
  };

  const onMouseMove = (event: ReactMouseEvent) => {
    const point = toPage(event);
    setHover(point);
    const drag = dragRef.current;
    if (drag?.kind !== "object-move" && drag?.kind !== "object-resize" && snapGuides) setSnapGuides(null);
    if (!drag && isEditor) {
      const next = editingObjectId || objectAt(point) ? null : blockAt(point);
      if (next?.id !== hoverBlock?.id) setHoverBlock(next);
      return;
    }
    if (!drag) return;
    if (drag.kind === "select") {
      store.setSelection({ pageIndex, x0: Math.min(drag.start.x, point.x), y0: Math.min(drag.start.y, point.y), x1: Math.max(drag.start.x, point.x), y1: Math.max(drag.start.y, point.y) });
    } else if (drag.kind === "move") {
      store.setPlacement({ pageIndex, x: point.x - drag.offset.x, y: point.y - drag.offset.y });
    } else if (drag.kind === "object-move") {
      const next = { x: Math.max(0, point.x - drag.offset.x), y: Math.max(0, point.y - drag.offset.y) };
      const current = pageObjects.find((entry) => entry.id === drag.id);
      if (!current) return;
      if (event.altKey) {
        if (snapGuides) setSnapGuides(null);
      } else {
        const rects = snapCandidateRects(drag.id);
        const margins = pageMarginCandidates(page.width, page.height);
        const candidatesX = [...margins, ...rectEdgeCandidates(rects, "x")];
        const candidatesY = [...margins, ...rectEdgeCandidates(rects, "y")];
        const tolerance = SNAP_TOLERANCE_PX / scale;
        const snapped = computeSnappedRect({ x: next.x, y: next.y, width: current.width, height: current.height }, candidatesX, candidatesY, tolerance, tolerance);
        next.x = snapped.x;
        next.y = snapped.y;
        setSnapGuides(snapped.guides.x.length || snapped.guides.y.length ? snapped.guides : null);
      }
      if (current.x === next.x && current.y === next.y) return;
      if (!drag.moved) {
        store.snapshot();
        drag.moved = true;
      }
      store.updateObject(drag.id, next);
    } else if (drag.kind === "object-resize") {
      let nextWidth = Math.max(MIN_OBJECT_SIZE, drag.width + (point.x - drag.start.x));
      let nextHeight = drag.aspect ? nextWidth / drag.aspect : drag.axis === "x" ? drag.height : Math.max(MIN_OBJECT_SIZE, drag.height + (point.y - drag.start.y));
      const current = pageObjects.find((entry) => entry.id === drag.id);
      if (event.altKey || !current) {
        if (snapGuides) setSnapGuides(null);
      } else {
        const rects = snapCandidateRects(drag.id);
        const margins = pageMarginCandidates(page.width, page.height);
        const tolerance = SNAP_TOLERANCE_PX / scale;
        const guides: { x: number[]; y: number[] } = { x: [], y: [] };
        const candidatesX = [...margins, ...rectEdgeCandidates(rects, "x")];
        const snappedRight = snapValue(current.x + nextWidth, candidatesX, tolerance, 1);
        if (snappedRight.guide !== null) {
          nextWidth = snappedRight.value - current.x;
          guides.x.push(snappedRight.guide);
          if (drag.aspect) nextHeight = nextWidth / drag.aspect;
        }
        if (drag.axis === "xy" && !drag.aspect) {
          const candidatesY = [...margins, ...rectEdgeCandidates(rects, "y")];
          const snappedBottom = snapValue(current.y + nextHeight, candidatesY, tolerance, 1);
          if (snappedBottom.guide !== null) {
            nextHeight = snappedBottom.value - current.y;
            guides.y.push(snappedBottom.guide);
          }
        }
        setSnapGuides(guides.x.length || guides.y.length ? guides : null);
      }
      store.updateObject(drag.id, { width: nextWidth, height: nextHeight });
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setSnapGuides(null);
    if (drag) noteRelease();
    if (!drag || drag.kind !== "select" || (mode !== "areaText" && mode !== "snapshot")) return;
    const current = useViewerOverlayStore.getState();
    const area = current.selection;
    if (!area || area.pageIndex !== pageIndex || !isUsableArea(area)) return;
    if (mode === "snapshot") current.requestSnapshot(area);
    else current.requestAreaText(area);
  };

  const onDoubleClick = (event: ReactMouseEvent) => {
    if (!isEditor || editingObjectId) return;
    const hit = objectAt(toPage(event));
    if (!hit || isLocked(hit.id)) return;
    if (hit.kind === "text") {
      caretRef.current = { x: event.clientX, y: event.clientY };
      store.setEditingObject(hit.id);
      return;
    }
    if (hit.kind === "imageChange" && !hit.deleted) {
      store.setSelectedObject(hit.id);
      replaceImageWithDialog(hit, t).catch((caught) => toast("error", describeError(t, toRpcError(caught))));
      return;
    }
    if (isDrawingImage(hit)) {
      store.setSelectedObject(hit.id);
      store.openDrawingEditor(hit.drawing.kind, hit.id);
    }
  };

  const activeSelection = selection && selection.pageIndex === pageIndex ? selection : null;
  const activeMeasure = measure && measure.pageIndex === pageIndex ? measure : null;
  const measurePreview = activeMeasure && activeMeasure.points.length === 1 && hover ? [activeMeasure.points[0], hover] : activeMeasure && activeMeasure.points.length === 2 ? activeMeasure.points : null;
  const selectionTone = mode === "redact" ? "border-destructive bg-destructive/25" : mode === "link" ? "border-success bg-success/15" : mode === "areaText" || mode === "snapshot" ? "border-primary bg-primary/10 border-dashed" : "border-primary bg-primary/15";
  const hoverObject = hover && isEditor && !dragRef.current ? objectAt(hover) : null;
  const cursor = isEditor
    ? hoverBlock
      ? hoverBlock.kind === "text"
        ? "text"
        : "move"
      : hoverObject
        ? hoverObject.kind === "block" || hoverObject.kind === "edit"
          ? "text"
          : "move"
        : mode === "image"
          ? pendingImage
            ? "copy"
            : "default"
          : "default"
    : mode === "signature"
      ? placementRect
        ? "move"
        : "copy"
      : "crosshair";
  const backgroundFor = (item: BlockPending): string => backgrounds[backgroundKey(item)] ?? contrastingBackground(item.style.color);
  const blockContainerStyle = (item: BlockPending): CSSProperties => ({
    fontSize: px(item.style.fontSize),
    lineHeight: item.leading > 0 && item.style.fontSize > 0 ? item.leading / item.style.fontSize : item.style.lineHeight,
    textAlign: item.style.align,
    opacity: item.opacity,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  });
  const planFamily = (item: BlockPending): string | null => {
    const resolution = fontResolutions[item.id];
    return resolution?.source === "system" && resolution.fontId ? (fontFamilies[fontFileKey(resolution.fontId, false)] ?? null) : null;
  };
  const blockRunFamily = (item: BlockPending, run: BlockRun): string => {
    const stack = fontStackForRun(run.font, run.fontXref, item.fontXref, item.fontFamily, fontFamilies, documentId, run.text || item.text);
    const plan = planFamily(item);
    return plan && (!run.fontXref || run.fontXref === item.fontXref) ? `"${plan}", ${stack}` : stack;
  };
  const chosenFamily = (item: Extract<EditorPending, { kind: "text" }>): string | null => (item.style.fontId ? (fontFamilies[fontFileKey(item.style.fontId, item.style.bold)] ?? null) : null);
  const textRunFamily = (item: Extract<EditorPending, { kind: "text" }>, run: BlockRun): string => {
    const chosen = chosenFamily(item);
    const stack = run.fontXref ? fontStackForRun(run.font, run.fontXref, 0, "", fontFamilies, documentId, run.text || item.text) : fontStackFor(null, "", null, run.text || item.text);
    return chosen ? `"${chosen}", ${stack}` : stack;
  };
  const blockEditorRunStyle = (item: BlockPending): RunStyler => (run) => runCss(run, blockRunFamily(item, run), px(run.size));
  const blockFitRunStyle = (item: BlockPending) => (run: BlockRun, scaledSizePx: number): CSSProperties => runCss(run, blockRunFamily(item, run), scaledSizePx);
  const imageTransform = (item: ImageChangePending): CSSProperties => {
    const turn = (item.rotate + item.placementRotation) % 360;
    const swap = turn === 90 || turn === 270;
    return {
      width: swap ? px(item.height) : px(item.width),
      height: swap ? px(item.width) : px(item.height),
      transform: `rotate(${turn}deg) scaleX(${item.flipH ? -1 : 1}) scaleY(${item.flipV ? -1 : 1})`,
      opacity: item.opacity,
    };
  };
  const handles = (id: string, free: boolean) => (
    <>
      <span data-move-handle={id} className="absolute -left-2.5 -top-2.5 flex size-5 cursor-move items-center justify-center rounded-md border border-white bg-primary text-white shadow-sm">
        <Move className="size-3" aria-hidden />
      </span>
      {free ? <span data-resize-handle={id} data-axis="x" className={`${HANDLE_CLASS} -right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize`} /> : null}
      <span data-resize-handle={id} className={`${HANDLE_CLASS} -bottom-1.5 -right-1.5 cursor-nwse-resize`} />
    </>
  );

  const selectedObject = pageObjects.find((item) => item.id === selectedObjectId) ?? null;
  const isDraggingSelected = dragRef.current !== null;
  const isEditingSelected = editingObjectId !== null && editingObjectId === selectedObjectId;
  const layerRect = layerRef.current?.getBoundingClientRect() ?? null;
  const toolbarObject = isEditor && selectedObject && !isDraggingSelected && !isEditingSelected ? selectedObject : null;
  const toolbarAnchorRect = toolbarObject && layerRect ? frameToScreen({ x: px(toolbarObject.x), y: px(toolbarObject.y), width: px(toolbarObject.width), height: px(toolbarObject.height) }, layerRect, viewTurnsOf(layerRef.current)) : null;

  return (
    <div
      ref={layerRef}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={() => {
        endDrag();
        setHover(null);
        setHoverBlock(null);
      }}
      className="absolute left-0 top-0 z-20 select-none"
      style={{ cursor, width: frame.width, height: frame.height, transform: frameTransform(turns, width, height), transformOrigin: "0 0" }}
    >
      {activeSelection ? (
        <div className={`absolute border-2 ${selectionTone}`} style={{ left: px(activeSelection.x0), top: px(activeSelection.y0), width: px(activeSelection.x1 - activeSelection.x0), height: px(activeSelection.y1 - activeSelection.y0) }} />
      ) : null}
      {activeSelection && mode === "crop" ? (
        <div
          className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_9999px_rgba(0,0,0,0.25)]"
          style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${px(activeSelection.x0)}px ${px(activeSelection.y0)}px, ${px(activeSelection.x0)}px ${px(activeSelection.y1)}px, ${px(activeSelection.x1)}px ${px(activeSelection.y1)}px, ${px(activeSelection.x1)}px ${px(activeSelection.y0)}px, ${px(activeSelection.x0)}px ${px(activeSelection.y0)}px)` }}
        />
      ) : null}
      {measurePreview ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <line x1={px(measurePreview[0].x)} y1={px(measurePreview[0].y)} x2={px(measurePreview[1].x)} y2={px(measurePreview[1].y)} stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4" />
          {measurePreview.map((point, index) => (
            <circle key={index} cx={px(point.x)} cy={px(point.y)} r={5} fill="var(--primary)" stroke="white" strokeWidth={2} />
          ))}
        </svg>
      ) : null}
      {measurePreview ? (
        <span
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-(--glass-border) bg-card/95 px-2 py-0.5 font-mono text-xs tabular-nums shadow-(--shadow-float)"
          style={{ left: px((measurePreview[0].x + measurePreview[1].x) / 2), top: px((measurePreview[0].y + measurePreview[1].y) / 2) - 28 }}
        >
          {formatLength(measureDistance(measurePreview[0], measurePreview[1]) * scaleDenominator, unit, locale)}
        </span>
      ) : null}
      {placementRect && signature ? (
        <img
          src={signature.dataUrl}
          alt=""
          draggable={false}
          className="absolute rounded-sm outline outline-2 outline-dashed outline-primary/70"
          style={{ left: px(placementRect.x0), top: px(placementRect.y0), width: px(placementRect.x1 - placementRect.x0), height: px(placementRect.y1 - placementRect.y0) }}
        />
      ) : null}
      {isEditor && blocks
        ? [...visibleBlocks]
            .sort((a, b) => blockArea(b) - blockArea(a))
            .map((block) => {
              const hovered = (hoverBlock?.id === block.id && !editingObjectId) || hoveredLayerKey === layerKey(pageIndex, block.id);
              return (
                <div
                  key={block.id}
                  data-block-kind={block.kind}
                  data-layer-key={layerKey(pageIndex, block.id)}
                  className={
                    hovered
                      ? "pointer-events-none absolute rounded-sm bg-primary/8 outline outline-2 outline-primary/80"
                      : block.kind === "text"
                        ? "pointer-events-none absolute rounded-sm outline outline-1 outline-dashed outline-foreground/25"
                        : "pointer-events-none absolute rounded-sm outline outline-1 outline-foreground/30"
                  }
                  style={{ left: px(block.bbox[0]) - 2, top: px(block.bbox[1]) - 2, width: px(block.bbox[2] - block.bbox[0]) + 4, height: px(block.bbox[3] - block.bbox[1]) + 4 }}
                />
              );
            })
        : null}
      {[...pageObjects]
        .sort((a, b) => b.width * b.height - a.width * a.height)
        .map((item) => {
        const selected = item.id === selectedObjectId;
        const editing = editingObjectId === item.id;
        const layerHovered = hoveredLayerKey === layerKey(pageIndex, item.id);
        const frame = { left: px(item.x), top: px(item.y), width: px(item.width), height: px(item.height), boxShadow: layerHovered ? "0 0 0 2px var(--ring)" : undefined };
        if (item.kind === "block") {
          const changed = isPendingChange(item);
          const deleted = item.text === "";
          const containerStyle = blockContainerStyle(item);
          const moved = rectChanged(item);
          return (
            <div key={item.id}>
              {moved && (changed || editing) ? (
                <div className="pointer-events-none absolute outline outline-1 outline-dashed outline-foreground/35" style={{ left: px(item.originalRect.x), top: px(item.originalRect.y), width: px(item.originalRect.width), height: px(item.originalRect.height), backgroundColor: backgroundFor(item) }} />
              ) : null}
              <div
                data-block-object={item.id}
                data-layer-key={layerKey(pageIndex, item.id)}
                className={deleted ? "absolute bg-destructive/15 outline outline-2 outline-dashed outline-destructive" : editing ? "absolute outline outline-2 outline-primary" : selected ? "absolute outline outline-2 outline-primary/80" : "absolute outline outline-1 outline-dashed outline-primary/50"}
                style={frame}
              >
                {editing ? (
                  <BlockEditor
                    id={item.id}
                    runs={item.runs}
                    fallbackStyle={{ font: item.style.font, fontXref: item.fontXref, size: item.style.fontSize, color: item.style.color, bold: item.style.bold, italic: item.style.italic, superscript: false }}
                    runStyle={blockEditorRunStyle(item)}
                    height={item.height}
                    scale={scale}
                    containerStyle={containerStyle}
                    background={backgroundFor(item)}
                    caret={caretRef.current}
                    onFinish={finishEditing}
                  />
                ) : changed && !deleted ? (
                  <FitText
                    runs={item.runs}
                    runStyle={blockFitRunStyle(item)}
                    className="h-full w-full whitespace-pre-wrap break-words"
                    style={{ ...containerStyle, backgroundColor: backgroundFor(item) }}
                    baseSizePt={item.style.fontSize}
                    pxPerPt={scale}
                    onFittedSize={(size) => {
                      if (size !== item.fittedSize) store.updateObject(item.id, { fittedSize: size });
                    }}
                  />
                ) : null}
                {selected || editing ? handles(item.id, true) : null}
              </div>
            </div>
          );
        }
        if (item.kind === "imageChange") {
          const moved = rectChanged(item);
          const preview = item.replacement?.dataUrl ?? imagePreviews[imagePreviewKey(pageIndex, item.xref)] ?? null;
          return (
            <div key={item.id}>
              {moved || item.deleted ? (
                <div className="pointer-events-none absolute bg-white/85 outline outline-1 outline-dashed outline-foreground/40" style={{ left: px(item.original.x), top: px(item.original.y), width: px(item.original.width), height: px(item.original.height) }} />
              ) : null}
              {!item.deleted ? (
                <div data-layer-key={layerKey(pageIndex, item.id)} className={selected ? "absolute cursor-move bg-primary/5 outline outline-2 outline-primary" : "absolute cursor-move outline outline-1 outline-dashed outline-primary/60"} style={frame}>
                  {preview && (moved || item.replacement || item.rotate !== 0 || item.flipH || item.flipV) ? (
                    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                      <img src={preview} alt="" draggable={false} className="max-w-none object-fill" style={imageTransform(item)} />
                    </div>
                  ) : null}
                  {selected ? handles(item.id, false) : null}
                </div>
              ) : (
                <div className="absolute bg-destructive/15 outline outline-2 outline-dashed outline-destructive" style={{ left: px(item.original.x), top: px(item.original.y), width: px(item.original.width), height: px(item.original.height) }} />
              )}
            </div>
          );
        }
        if (item.kind === "edit") {
          return null;
        }
        const plainRunStyle: RunStyler = (run) => runCss(run, item.kind === "text" ? textRunFamily(item, run) : fontStackFor(null, "", null, run.text), px(run.size));
        const textRuns = item.kind === "text" && item.runs && item.runs.length > 0 ? item.runs : null;
        const singleRun = item.kind === "text" ? [{ font: null, fontXref: 0, size: item.style.fontSize, color: item.style.color, bold: item.style.bold, italic: false, superscript: false, text: item.text }] : [];
        return (
          <div key={item.id} data-layer-key={layerKey(pageIndex, item.id)} className={selected ? "absolute outline outline-2 outline-primary" : "absolute outline outline-1 outline-dashed outline-primary/40"} style={frame}>
            {item.kind === "image" ? (
              <img src={item.dataUrl} alt="" draggable={false} className="h-full w-full object-fill" style={{ opacity: item.opacity }} />
            ) : editing ? (
              <BlockEditor
                id={item.id}
                runs={textRuns ?? singleRun}
                fallbackStyle={{ font: null, fontXref: 0, size: item.style.fontSize, color: item.style.color, bold: item.style.bold, italic: false, superscript: false } as RunStyle}
                runStyle={plainRunStyle}
                height={item.height}
                scale={scale}
                containerStyle={{ fontSize: px(item.style.fontSize), textAlign: item.style.align, lineHeight: 1.25, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                background="rgba(255,255,255,0.7)"
                caret={caretRef.current}
                onFinish={finishEditing}
              />
            ) : textRuns && hasMixedStyles(textRuns) ? (
              <div className="h-full w-full overflow-hidden whitespace-pre-wrap break-words" style={{ fontSize: px(item.style.fontSize), textAlign: item.style.align, lineHeight: 1.25, opacity: item.opacity }}>
                {renderRuns(textRuns, plainRunStyle)}
              </div>
            ) : (
              <div
                className="h-full w-full overflow-hidden whitespace-pre-wrap break-words"
                style={{ fontSize: px(item.style.fontSize), color: item.style.color, fontWeight: item.style.bold ? 700 : 400, textAlign: item.style.align, lineHeight: 1.25, fontFamily: textRunFamily(item, singleRun[0]), opacity: item.opacity }}
              >
                {item.text}
              </div>
            )}
            {selected || editing ? handles(item.id, item.kind === "text") : null}
          </div>
        );
      })}
      {snapGuides ? <SnapGuides guides={snapGuides} scale={scale} width={frame.width} height={frame.height} /> : null}
      {toolbarObject && toolbarAnchorRect ? <ObjectToolbar item={toolbarObject} anchorRect={toolbarAnchorRect} viewportSize={{ width: window.innerWidth, height: window.innerHeight }} /> : null}
    </div>
  );
}
