import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { ArrowDownToLine, ArrowUpToLine, ClipboardPaste, Copy, CopyPlus, Group, Lock, PaintBucket, Paintbrush, Scissors, Trash2, Ungroup } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { cn } from "@/shared/lib/cn";
import { isControlTarget, isTextEntryTarget } from "@/shared/lib/typingTarget";
import type { StudioDesign, StudioElement, StudioPage, StudioTextElement } from "@/types/studio";
import { addGuide, guidesOf, marginsOf, moveGuide, removeGuide } from "../model/guides";
import { duplicateElements, elementBounds, selectionBounds, unionBounds, updateElement, updatePage, moveElements, withoutGroupOf, type Bounds } from "../model/edit";
import { canvasBridge } from "./canvasBridge";
import { HoverOutline, PageFrames, ReadoutTag, SnapLines, SpanMarks, type Readout } from "./CanvasMarks";
import { canGroup, canUngroup, group, reorder, toggleLock, ungroup } from "./commands";
import { ElementView, PageView } from "./ElementView";
import { pickImage } from "./pickImage";
import { CanvasRulers, type RulerExtent, type RulerHandlers } from "./Rulers";
import { buildSnapIndex, measureAround, snapMove, snapPosition, snapResize, type Axis, type SnapExtras, type SnapIndex, type SnapLine, type Span } from "./snapping";
import { copyStyle, pasteStyle, useStyleClipboard } from "./styleClipboard";
import { TextEditor } from "./TextEditor";
import { textEditorEntry } from "./textEditorBridge";
import { HANDLES, boundsOf, resizeBox, rotateElements, rotationFromPointer, scaleElements, turnFromPointer, type Handle, type Vector } from "./transform";
import { currentPage, useStudioStore } from "./studioStore";
import { formatMm, fromMm } from "./units";
import { BLEED_MM, useViewPrefs } from "./viewPrefs";

const PAD = 48;
const DRAG_THRESHOLD = 3;
const SNAP_PIXELS = 6;
const ZOOM_STEP = 1.1;
const SELECTION_ZOOM_MARGIN = 0.8;

type Point = Vector;
type Drag =
  | { kind: "move"; before: StudioDesign; base: StudioDesign; ids: string[]; original: string[]; origin: Point; moved: boolean; duplicate: boolean; index: SnapIndex; start: Bounds; anchor: Point }
  | { kind: "resize"; before: StudioDesign; handle: Handle; elements: StudioElement[]; origin: Point; start: Bounds; index: SnapIndex }
  | { kind: "rotate"; before: StudioDesign; element: StudioElement }
  | { kind: "turn"; before: StudioDesign; elements: StudioElement[]; centre: Point; origin: Point; box: Bounds }
  | { kind: "guide"; before: StudioDesign; pageId: string; index: number; axis: Axis; created: boolean; removing: boolean; snap: SnapIndex }
  | { kind: "marquee"; origin: Point; base: string[] }
  | { kind: "pan"; origin: Point; scroll: Point };

type Feedback = { lines: SnapLine[]; gaps: Span[]; distances: Span[]; readout: Readout | null };

const CURSORS: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };
const NO_FEEDBACK: Feedback = { lines: [], gaps: [], distances: [], readout: null };

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function handlesFor(elements: StudioElement[]): Handle[] {
  if (elements.length !== 1) return ["nw", "ne", "se", "sw"];
  const [element] = elements;
  if (element.kind === "shape" && (element.shape === "line" || element.shape === "arrowLine")) return ["e", "w"];
  if (element.kind === "text") return ["nw", "ne", "se", "sw", "e", "w"];
  return HANDLES;
}

function handlePosition(handle: Handle, width: number, height: number): Point {
  return { x: handle.includes("e") ? width : handle.includes("w") ? 0 : width / 2, y: handle.includes("s") ? height : handle.includes("n") ? 0 : height / 2 };
}

function snapExtras(page: StudioPage, design: StudioDesign): SnapExtras {
  const view = useViewPrefs.getState();
  const extras: SnapExtras = { x: [], y: [] };
  if (view.guides) for (const guide of guidesOf(page)) extras[guide.axis].push(guide.position);
  const inset = fromMm(marginsOf(design));
  if (view.margins && inset > 0) {
    extras.x.push(inset, page.width - inset);
    extras.y.push(inset, page.height - inset);
  }
  return extras;
}

function snapIndexFor(page: StudioPage, design: StudioDesign, exclude: ReadonlySet<string>): SnapIndex {
  const others = page.elements.filter((element) => !exclude.has(element.id) && !element.hidden).map(elementBounds);
  return buildSnapIndex(page, others, snapExtras(page, design));
}

function RotateGrip() {
  return (
    <>
      <span aria-hidden className="absolute left-1/2 h-4 w-px bg-primary" style={{ top: -18 }} />
      <span data-handle="rotate" aria-hidden className="pointer-events-auto absolute left-1/2 size-4 -translate-x-1/2 cursor-grab rounded-full border-2 border-primary bg-background" style={{ top: -30 }} />
    </>
  );
}

export function Canvas({ language }: { language: string }) {
  const { t } = useTranslation();
  const design = useStudioStore((state) => state.design);
  const page = useStudioStore((state) => currentPage(state));
  const selection = useStudioStore((state) => state.selection);
  const editingId = useStudioStore((state) => state.editingId);
  const zoom = useStudioStore((state) => state.zoom);
  const fit = useStudioStore((state) => state.fit);
  const showRulers = useViewPrefs((state) => state.rulers);
  const showGuides = useViewPrefs((state) => state.guides);
  const showMargins = useViewPrefs((state) => state.margins);
  const showBleed = useViewPrefs((state) => state.bleed);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const zoomAnchor = useRef<{ page: Point; client: Point } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(NO_FEEDBACK);
  const [marquee, setMarquee] = useState<Bounds | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [turn, setTurn] = useState<{ box: Bounds; angle: number } | null>(null);
  const [movingGuide, setMovingGuide] = useState<{ index: number; removing: boolean } | null>(null);
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const spaceHeld = useRef(false);
  const menu = useContextMenu();

  const selected = useMemo(() => (page ? page.elements.filter((element) => selection.includes(element.id)) : []), [page, selection]);
  const number = useMemo(() => (points: number) => formatMm(points, language), [language]);
  const degrees = useMemo(() => {
    const format = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
    return (angle: number) => `${format.format(angle)}°`;
  }, [language]);

  const pageWidth = page?.width ?? 0;
  const pageHeight = page?.height ?? 0;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pageWidth || !pageHeight || !fit) return;
    const measure = () => {
      const width = viewport.clientWidth - PAD * 2;
      const height = viewport.clientHeight - PAD * 2;
      if (width > 0 && height > 0) useStudioStore.getState().applyFitZoom(Math.min(width / pageWidth, height / pageHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fit, pageWidth, pageHeight]);

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const viewport = viewportRef.current;
    const host = pageRef.current;
    if (!anchor || !viewport || !host) return;
    zoomAnchor.current = null;
    const rect = host.getBoundingClientRect();
    viewport.scrollLeft += rect.left + anchor.page.x * zoom - anchor.client.x;
    viewport.scrollTop += rect.top + anchor.page.y * zoom - anchor.client.y;
  }, [zoom]);

  useEffect(
    () =>
      useStudioStore.subscribe((next, previous) => {
        if (next.zoom === previous.zoom || next.fit || zoomAnchor.current) return;
        const viewport = viewportRef.current;
        const host = pageRef.current;
        if (!viewport || !host) return;
        const view = viewport.getBoundingClientRect();
        const rect = host.getBoundingClientRect();
        const client = { x: view.left + view.width / 2, y: view.top + view.height / 2 };
        zoomAnchor.current = { page: { x: (client.x - rect.left) / previous.zoom, y: (client.y - rect.top) / previous.zoom }, client };
      }),
    [],
  );

  useEffect(() => {
    const release = () => {
      spaceHeld.current = false;
      setPanReady(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const current = drag.current;
      if (event.key === "Escape" && current) {
        event.preventDefault();
        event.stopPropagation();
        drag.current = null;
        setFeedback(NO_FEEDBACK);
        setMarquee(null);
        setTurn(null);
        setMovingGuide(null);
        setPanning(false);
        const state = useStudioStore.getState();
        if (current.kind === "marquee") state.select(current.base);
        else if (current.kind !== "pan") state.preview(() => current.before);
        if (current.kind === "move" && current.ids !== current.original) state.select(current.original);
        return;
      }
      if (event.code !== "Space" || event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target) || isControlTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      if (!spaceHeld.current) {
        spaceHeld.current = true;
        setPanReady(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") release();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  useEffect(() => {
    canvasBridge.current = {
      zoomToSelection: () => {
        const viewport = viewportRef.current;
        const state = useStudioStore.getState();
        const current = currentPage(state);
        if (!viewport || !current) return;
        const box = (state.selection.length ? selectionBounds(current, state.selection) : null) ?? { x: 0, y: 0, width: current.width, height: current.height };
        const view = viewport.getBoundingClientRect();
        const target = Math.min((view.width * SELECTION_ZOOM_MARGIN) / Math.max(1, box.width), (view.height * SELECTION_ZOOM_MARGIN) / Math.max(1, box.height));
        zoomAnchor.current = { page: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, client: { x: view.left + view.width / 2, y: view.top + view.height / 2 } };
        state.setZoom(target);
        if (useStudioStore.getState().zoom === state.zoom) {
          zoomAnchor.current = null;
          const rect = pageRef.current?.getBoundingClientRect();
          if (!rect) return;
          viewport.scrollLeft += rect.left + (box.x + box.width / 2) * state.zoom - (view.left + view.width / 2);
          viewport.scrollTop += rect.top + (box.y + box.height / 2) * state.zoom - (view.top + view.height / 2);
        }
      },
    };
    return () => {
      canvasBridge.current = null;
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const host = pageRef.current;
      if (!host) return;
      const state = useStudioStore.getState();
      const rect = host.getBoundingClientRect();
      zoomAnchor.current = { page: { x: (event.clientX - rect.left) / state.zoom, y: (event.clientY - rect.top) / state.zoom }, client: { x: event.clientX, y: event.clientY } };
      state.setZoom(state.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  if (!design || !page) return null;

  const toPage = (clientX: number, clientY: number): Point => {
    const rect = pageRef.current?.getBoundingClientRect();
    return rect ? { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom } : { x: 0, y: 0 };
  };

  const store = () => useStudioStore.getState();
  const snapping = (event: { ctrlKey: boolean; metaKey: boolean }) => useViewPrefs.getState().snap && !event.ctrlKey && !event.metaKey;
  const tolerance = SNAP_PIXELS / zoom;

  const beginMove = (event: ReactPointerEvent, ids: string[]) => {
    const state = store();
    const current = currentPage(state);
    if (!state.design || !current) return;
    const start = selectionBounds(current, ids) ?? { x: 0, y: 0, width: 0, height: 0 };
    const only = ids.length === 1 ? current.elements.find((element) => element.id === ids[0]) : undefined;
    drag.current = {
      kind: "move",
      before: state.design,
      base: state.design,
      ids,
      original: ids,
      origin: toPage(event.clientX, event.clientY),
      moved: false,
      duplicate: event.altKey && !event.ctrlKey && !event.metaKey,
      index: snapIndexFor(current, state.design, new Set(ids)),
      start,
      anchor: only ? { x: only.x, y: only.y } : { x: start.x, y: start.y },
    };
  };

  const startDuplicate = (current: Extract<Drag, { kind: "move" }>) => {
    const source = current.before.pages.find((item) => item.id === page.id);
    if (!source) return;
    const chosen = new Set(current.ids);
    const movable = source.elements.filter((element) => chosen.has(element.id) && !element.locked).map((element) => element.id);
    const result = movable.length ? duplicateElements(source, movable, 0) : null;
    if (!result?.ids.length) return;
    current.base = updatePage(current.before, page.id, () => result.page);
    current.ids = result.ids;
    current.index = snapIndexFor(result.page, current.base, new Set(result.ids));
    const state = store();
    state.preview(() => current.base);
    state.select(result.ids);
  };

  const beginGuide = (event: ReactPointerEvent, axis: Axis, existing: number | null) => {
    const state = store();
    const current = currentPage(state);
    if (!state.design || !current) return;
    const point = toPage(event.clientX, event.clientY);
    let index = existing;
    if (index === null) {
      const next = addGuide(current, { axis, position: axis === "x" ? point.x : point.y });
      if (next === current) return;
      index = guidesOf(next).length - 1;
      const base = updatePage(state.design, current.id, () => next);
      state.preview(() => base);
    }
    const created = existing === null;
    drag.current = { kind: "guide", before: state.design, pageId: current.id, index, axis, created, removing: created, snap: snapIndexFor(current, state.design, new Set()) };
    setMovingGuide({ index, removing: created });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    setHover(null);
    if (viewport && (event.button === 1 || (event.button === 0 && spaceHeld.current))) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { kind: "pan", origin: { x: event.clientX, y: event.clientY }, scroll: { x: viewport.scrollLeft, y: viewport.scrollTop } };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;
    if (viewport && event.target === viewport) {
      const box = viewport.getBoundingClientRect();
      if (event.clientX - box.left >= viewport.clientWidth || event.clientY - box.top >= viewport.clientHeight) return;
    }
    const target = event.target as HTMLElement;
    const state = store();
    const guide = target.closest<HTMLElement>("[data-guide]");
    if (guide && state.design) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      beginGuide(event, guide.dataset.axis === "x" ? "x" : "y", Number(guide.dataset.guide));
      return;
    }
    const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle as Handle | "rotate" | undefined;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (handle && state.design) {
      event.preventDefault();
      const elements = currentPage(state)?.elements.filter((element) => state.selection.includes(element.id) && !element.locked) ?? [];
      if (!elements.length) return;
      const origin = toPage(event.clientX, event.clientY);
      const start = boundsOf(elements) as Bounds;
      if (handle === "rotate" && state.selection.length > 1) {
        drag.current = { kind: "turn", before: state.design, elements, centre: { x: start.x + start.width / 2, y: start.y + start.height / 2 }, origin, box: start };
      } else if (handle === "rotate") drag.current = { kind: "rotate", before: state.design, element: elements[0] };
      else drag.current = { kind: "resize", before: state.design, handle, elements, origin, start, index: snapIndexFor(page, state.design, new Set(state.selection)) };
      return;
    }
    const hit = target.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    if (state.editingId && hit !== state.editingId) state.setEditing(null);
    if (hit) {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
        const stack = [...new Set(document.elementsFromPoint(event.clientX, event.clientY).map((node) => node.closest<HTMLElement>("[data-element-id]")?.dataset.elementId).filter((id): id is string => Boolean(id)))];
        const index = stack.findIndex((id) => state.selection.includes(id));
        state.select([stack[index >= 0 ? (index + 1) % stack.length : 0] ?? hit]);
        beginMove(event, store().selection);
        return;
      }
      const ids = state.selection.includes(hit) ? state.selection : [hit];
      const next = event.shiftKey ? (state.selection.includes(hit) ? withoutGroupOf(page, state.selection, hit) : [...state.selection, hit]) : ids;
      state.select(next);
      if (!event.shiftKey && page.elements.find((element) => element.id === hit)?.locked) {
        drag.current = { kind: "marquee", origin: toPage(event.clientX, event.clientY), base: [] };
        return;
      }
      beginMove(event, store().selection);
      return;
    }
    const origin = toPage(event.clientX, event.clientY);
    if (!event.shiftKey) state.select([]);
    drag.current = { kind: "marquee", origin, base: event.shiftKey ? state.selection : [] };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) {
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-element-id]")?.dataset.elementId ?? null;
      setHover(id);
      return;
    }
    if (current.kind === "pan") {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollLeft = current.scroll.x - (event.clientX - current.origin.x);
      viewport.scrollTop = current.scroll.y - (event.clientY - current.origin.y);
      return;
    }
    const point = toPage(event.clientX, event.clientY);
    const state = store();
    if (current.kind === "marquee") {
      const box = { x: Math.min(point.x, current.origin.x), y: Math.min(point.y, current.origin.y), width: Math.abs(point.x - current.origin.x), height: Math.abs(point.y - current.origin.y) };
      setMarquee(box);
      const hits = currentPage(state)?.elements.filter((element) => !element.hidden && !element.locked && intersects(elementBounds(element), box)).map((element) => element.id) ?? [];
      state.select([...new Set([...current.base, ...hits])]);
      return;
    }
    if (current.kind === "guide") {
      const raw = current.axis === "x" ? point.x : point.y;
      const position = snapping(event) ? snapPosition(current.snap, current.axis, raw, tolerance) : raw;
      const view = viewportRef.current?.getBoundingClientRect();
      const removing = view ? (current.axis === "x" ? event.clientX < view.left : event.clientY < view.top) : false;
      current.removing = removing;
      state.preview((next) => updatePage(next, current.pageId, (item) => moveGuide(item, current.index, position)));
      setMovingGuide({ index: current.index, removing });
      setFeedback({ ...NO_FEEDBACK, readout: removing ? null : { text: `${current.axis === "x" ? "X" : "Y"} ${number(position)} mm`, x: point.x, y: point.y } });
      return;
    }
    if (current.kind === "move") {
      let dx = point.x - current.origin.x;
      let dy = point.y - current.origin.y;
      if (!current.moved && Math.hypot(dx, dy) * zoom < DRAG_THRESHOLD) return;
      if (!current.moved) {
        current.moved = true;
        if (current.duplicate) startDuplicate(current);
      }
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      let lines: SnapLine[] = [];
      let gaps: Span[] = [];
      if (snapping(event)) {
        const snapped = snapMove({ ...current.start, x: current.start.x + dx, y: current.start.y + dy }, current.index, tolerance);
        dx += snapped.dx;
        dy += snapped.dy;
        lines = snapped.lines;
        gaps = snapped.spans;
      }
      const box = { ...current.start, x: current.start.x + dx, y: current.start.y + dy };
      const distances = measureAround(current.index, box).filter((span) => !gaps.some((gap) => gap.axis === span.axis));
      setFeedback({ lines, gaps, distances, readout: { text: `X ${number(current.anchor.x + dx)}  Y ${number(current.anchor.y + dy)} mm`, x: point.x, y: point.y } });
      const ids = current.ids;
      state.preview(() => updatePage(current.base, page.id, (item) => moveElements(item, ids, dx, dy)));
      return;
    }
    if (current.kind === "rotate") {
      const element = current.element;
      const rotation = rotationFromPointer({ x: element.x + element.width / 2, y: element.y + element.height / 2 }, point, { step: event.shiftKey });
      setFeedback({ ...NO_FEEDBACK, readout: { text: degrees(rotation), x: point.x, y: point.y } });
      state.preview(() => updatePage(current.before, page.id, (item) => updateElement(item, element.id, { rotation })));
      return;
    }
    if (current.kind === "turn") {
      const angle = turnFromPointer(current.centre, current.origin, point, { step: event.shiftKey });
      const turned = rotateElements(current.elements, current.centre, angle);
      setTurn({ box: current.box, angle });
      setFeedback({ ...NO_FEEDBACK, readout: { text: degrees(angle), x: point.x, y: point.y } });
      state.preview(() => updatePage(current.before, page.id, (item) => turned.reduce((acc, element) => updateElement<StudioElement>(acc, element.id, element), item)));
      return;
    }
    const dx = point.x - current.origin.x;
    const dy = point.y - current.origin.y;
    const corner = current.handle.length === 2;
    const snap = snapping(event);
    if (current.elements.length === 1) {
      const element = current.elements[0];
      const keepRatio = corner && (element.kind === "text" || element.kind === "image" || element.kind === "qr" ? !event.shiftKey : event.shiftKey);
      const options = { keepRatio, fromCenter: event.altKey };
      const result = snap ? snapResize(element, current.handle, dx, dy, options, current.index, tolerance) : { box: resizeBox(element, current.handle, dx, dy, options), lines: [] };
      const box = result.box;
      const patch: Partial<StudioElement> = { x: box.x, y: box.y, width: box.width, height: box.height };
      if (element.kind === "text" && corner && keepRatio) (patch as Partial<StudioTextElement>).fontSize = Math.max(1, Math.min(1000, element.fontSize * (box.width / element.width)));
      if (element.kind === "qr") patch.height = box.width;
      setFeedback({ ...NO_FEEDBACK, lines: result.lines, readout: { text: `${number(box.width)} × ${number(patch.height ?? box.height)} mm`, x: point.x, y: point.y } });
      state.preview(() => updatePage(current.before, page.id, (item) => updateElement(item, element.id, patch)));
      return;
    }
    const options = { keepRatio: !event.shiftKey, fromCenter: event.altKey };
    const frame = { ...current.start, rotation: 0 };
    const result = snap ? snapResize(frame, current.handle, dx, dy, options, current.index, tolerance) : { box: resizeBox(frame, current.handle, dx, dy, options), lines: [] };
    const target = { x: result.box.x, y: result.box.y, width: result.box.width, height: result.box.height };
    const scaled = scaleElements(current.elements, current.start, target);
    setFeedback({ ...NO_FEEDBACK, lines: result.lines, readout: { text: `${number(target.width)} × ${number(target.height)} mm`, x: point.x, y: point.y } });
    state.preview(() => updatePage(current.before, page.id, (item) => scaled.reduce((acc, element) => updateElement<StudioElement>(acc, element.id, element), item)));
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    setFeedback(NO_FEEDBACK);
    setMarquee(null);
    setTurn(null);
    setMovingGuide(null);
    setPanning(false);
    if (!current || current.kind === "marquee" || current.kind === "pan") return;
    if (current.kind === "move" && !current.moved) return;
    if (current.kind === "guide" && current.removing) {
      store().preview(() => (current.created ? current.before : updatePage(current.before, current.pageId, (item) => removeGuide(item, current.index))));
    }
    store().settle(current.before);
  };

  const onRulerPointerDown: RulerHandlers["onPointerDown"] = (axis, event) => {
    if (event.button !== 0 || !store().design) return;
    event.preventDefault();
    if (!useViewPrefs.getState().guides) useViewPrefs.getState().toggle("guides");
    event.currentTarget.setPointerCapture(event.pointerId);
    beginGuide(event, axis === "x" ? "y" : "x", null);
  };

  const onRulerDoubleClick: RulerHandlers["onDoubleClick"] = (axis, event) => {
    const point = toPage(event.clientX, event.clientY);
    if (!useViewPrefs.getState().guides) useViewPrefs.getState().toggle("guides");
    store().applyToPage((current) => addGuide(current, axis === "x" ? { axis: "x", position: point.x } : { axis: "y", position: point.y }));
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const guide = (event.target as HTMLElement).closest<HTMLElement>("[data-guide]");
    if (guide) {
      const index = Number(guide.dataset.guide);
      store().applyToPage((current) => removeGuide(current, index));
      return;
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    const element = page.elements.find((item) => item.id === hit);
    if (element?.kind === "text" && !element.locked) {
      store().select([element.id]);
      textEditorEntry.point = { x: event.clientX, y: event.clientY };
      store().setEditing(element.id);
    }
    if (element?.kind === "image" && !element.locked) {
      void pickImage(t("studio.props.replaceImage")).then((src) => {
        if (src) store().applyToPage((current) => updateElement<StudioElement>(current, element.id, { src }));
      });
    }
  };

  const onContextMenu = (event: React.MouseEvent) => {
    const hit = (event.target as HTMLElement).closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    if (hit && !store().selection.includes(hit)) store().select([hit]);
    menu.open(event);
  };

  const state = store();
  const menuItems: ContextMenuItem[] = [
    { type: "item", id: "cut", label: t("studio.menu.cut"), icon: Scissors, shortcut: "Ctrl+X", disabled: !selection.length, onSelect: state.cut },
    { type: "item", id: "copy", label: t("studio.menu.copy"), icon: Copy, shortcut: "Ctrl+C", disabled: !selection.length, onSelect: state.copy },
    { type: "item", id: "paste", label: t("studio.menu.paste"), icon: ClipboardPaste, shortcut: "Ctrl+V", disabled: !state.clipboard?.length, onSelect: state.paste },
    { type: "item", id: "duplicate", label: t("studio.menu.duplicate"), icon: CopyPlus, shortcut: "Ctrl+D", disabled: !selection.length, onSelect: state.duplicate },
    { type: "item", id: "copyStyle", label: t("studio.menu.copyStyle"), icon: Paintbrush, shortcut: "Ctrl+Alt+C", disabled: !selection.length, onSelect: copyStyle },
    { type: "item", id: "pasteStyle", label: t("studio.menu.pasteStyle"), icon: PaintBucket, shortcut: "Ctrl+Alt+V", disabled: !selection.length || !useStyleClipboard.getState().style, onSelect: pasteStyle },
    { type: "separator", id: "s1" },
    { type: "item", id: "front", label: t("studio.menu.front"), icon: ArrowUpToLine, shortcut: "Ctrl+Shift+↑", disabled: !selection.length, onSelect: () => reorder("front") },
    { type: "item", id: "back", label: t("studio.menu.back"), icon: ArrowDownToLine, shortcut: "Ctrl+Shift+↓", disabled: !selection.length, onSelect: () => reorder("back") },
    { type: "item", id: "group", label: t("studio.menu.group"), icon: Group, shortcut: "Ctrl+G", disabled: !canGroup(), onSelect: group },
    { type: "item", id: "ungroup", label: t("studio.menu.ungroup"), icon: Ungroup, shortcut: "Ctrl+Shift+G", disabled: !canUngroup(), onSelect: ungroup },
    { type: "item", id: "lock", label: t("studio.menu.lock"), icon: Lock, checked: selected.length > 0 && selected.every((element) => element.locked), disabled: !selection.length, onSelect: toggleLock },
    { type: "separator", id: "s2" },
    { type: "item", id: "delete", label: t("studio.menu.delete"), icon: Trash2, shortcut: "Delete", disabled: !selection.length, onSelect: state.remove },
  ];

  const frame = selected.length === 1 ? selected[0] : null;
  const groupBox = turn?.box ?? (selected.length > 1 ? boundsOf(selected) : null);
  const showHandles = !editingId && selected.length > 0 && selected.some((element) => !element.locked);
  const pageLeft = `max(${PAD}px, calc(50% - ${(page.width * zoom) / 2}px))`;
  const guides = showGuides ? guidesOf(page) : [];
  const selectionBox = selected.length ? unionBounds(selected.map(elementBounds)) : null;
  const extent: RulerExtent = selectionBox ? { x: [selectionBox.x, selectionBox.x + selectionBox.width], y: [selectionBox.y, selectionBox.y + selectionBox.height] } : null;
  const hovered = hover && !editingId && !selection.includes(hover) ? page.elements.find((element) => element.id === hover && !element.hidden) : undefined;
  const hoverBox = hovered?.groupId ? unionBounds(page.elements.filter((element) => element.groupId === hovered.groupId && !element.hidden).map(elementBounds)) : null;

  return (
    <div className="relative min-h-0 flex-1">
      {showRulers ? <CanvasRulers viewportRef={viewportRef} pageRef={pageRef} zoom={zoom} extent={extent} language={language} handlers={{ onPointerDown: onRulerPointerDown, onPointerMove, onPointerUp, onDoubleClick: onRulerDoubleClick }} /> : null}
      <div
        ref={viewportRef}
        data-testid="studio-viewport"
        className={cn("absolute bottom-0 right-0 overflow-auto bg-muted/40", showRulers ? "left-6 top-6" : "left-0 top-0", panning ? "cursor-grabbing" : panReady && "cursor-grab")}
        onPointerDown={onPointerDown}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onWheelCapture={(event: ReactWheelEvent) => {
          if (event.ctrlKey) event.stopPropagation();
        }}
      >
        <div style={{ position: "relative", width: `${page.width * zoom + PAD * 2}px`, height: `${page.height * zoom + PAD * 2}px`, minWidth: "100%", minHeight: "100%" }}>
          <div
            ref={pageRef}
            role="region"
            aria-label={t("studio.canvas.label")}
            className="absolute shadow-lg"
            style={{ left: pageLeft, top: `${PAD}px`, width: `${page.width * zoom}px`, height: `${page.height * zoom}px` }}
          >
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", width: `${page.width}px`, height: `${page.height}px` }}>
              <PageView
                page={page}
                language={language}
                renderElement={(element) =>
                  element.id === editingId && element.kind === "text" ? (
                    <ElementView key={element.id} element={element} language={language}>
                      <TextEditor element={element} language={language} />
                    </ElementView>
                  ) : (
                    <ElementView key={element.id} element={element} language={language} />
                  )
                }
              />
            </div>
            <div className="pointer-events-none absolute inset-0 z-20">
              <PageFrames width={page.width} height={page.height} margin={showMargins ? fromMm(marginsOf(design)) : 0} bleed={showBleed ? fromMm(BLEED_MM) : 0} zoom={zoom} />
              {hovered ? <HoverOutline box={hoverBox ?? { x: hovered.x, y: hovered.y, width: hovered.width, height: hovered.height }} rotation={hoverBox ? 0 : hovered.rotation} zoom={zoom} /> : null}
              {selected.map((element) => {
                const box = elementBounds(element);
                return selected.length > 1 ? <div key={element.id} className="absolute border border-primary/60" style={{ left: box.x * zoom, top: box.y * zoom, width: box.width * zoom, height: box.height * zoom }} /> : null;
              })}
              {frame ? (
                <div
                  data-testid="studio-selection"
                  className={cn("absolute border-2", frame.locked ? "border-muted-foreground" : "border-primary")}
                  style={{ left: frame.x * zoom, top: frame.y * zoom, width: frame.width * zoom, height: frame.height * zoom, transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined }}
                >
                  {showHandles ? (
                    <>
                      {handlesFor([frame]).map((handle) => {
                        const spot = handlePosition(handle, frame.width * zoom, frame.height * zoom);
                        return (
                          <span
                            key={handle}
                            data-handle={handle}
                            aria-hidden
                            className="pointer-events-auto absolute size-3 rounded-full border-2 border-primary bg-background"
                            style={{ left: spot.x - 6, top: spot.y - 6, cursor: CURSORS[handle] }}
                          />
                        );
                      })}
                      <RotateGrip />
                    </>
                  ) : null}
                </div>
              ) : null}
              {groupBox ? (
                <div
                  data-testid="studio-selection"
                  className="absolute border-2 border-dashed border-primary"
                  style={{ left: groupBox.x * zoom, top: groupBox.y * zoom, width: groupBox.width * zoom, height: groupBox.height * zoom, transform: turn?.angle ? `rotate(${turn.angle}deg)` : undefined }}
                >
                  {showHandles && !turn ? (
                    <>
                      {handlesFor(selected).map((handle) => {
                        const spot = handlePosition(handle, groupBox.width * zoom, groupBox.height * zoom);
                        return <span key={handle} data-handle={handle} aria-hidden className="pointer-events-auto absolute size-3 rounded-full border-2 border-primary bg-background" style={{ left: spot.x - 6, top: spot.y - 6, cursor: CURSORS[handle] }} />;
                      })}
                      <RotateGrip />
                    </>
                  ) : null}
                </div>
              ) : null}
              <SnapLines lines={feedback.lines} zoom={zoom} />
              <SpanMarks spans={feedback.distances} zoom={zoom} format={number} emphasis={false} />
              <SpanMarks spans={feedback.gaps} zoom={zoom} format={number} emphasis />
              {marquee ? <div className="absolute border border-primary bg-primary/10" style={{ left: marquee.x * zoom, top: marquee.y * zoom, width: marquee.width * zoom, height: marquee.height * zoom }} /> : null}
              {feedback.readout ? <ReadoutTag readout={feedback.readout} zoom={zoom} /> : null}
            </div>
          </div>
          {guides.length ? (
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
              {guides.map((guide, index) => {
                const vertical = guide.axis === "x";
                const fading = movingGuide?.index === index && movingGuide.removing;
                return (
                  <div
                    key={index}
                    data-guide={index}
                    data-axis={guide.axis}
                    data-testid="studio-guide"
                    title={t("studio.view.guideHint")}
                    className={cn("pointer-events-auto absolute flex justify-center", vertical ? "inset-y-0 w-2 -translate-x-1/2 cursor-col-resize" : "inset-x-0 h-2 -translate-y-1/2 flex-col cursor-row-resize")}
                    style={vertical ? { left: `calc(${pageLeft} + ${guide.position * zoom}px)` } : { top: PAD + guide.position * zoom }}
                  >
                    <span className={cn(vertical ? "h-full w-px" : "h-px w-full", fading ? "bg-success/30" : "bg-success")} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      {menu.anchor ? <ContextMenu anchor={menu.anchor} items={menuItems} label={t("studio.menu.label")} onClose={menu.close} /> : null}
    </div>
  );
}
