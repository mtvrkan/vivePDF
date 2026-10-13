import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { StudioPage } from "@/types/studio";
import { addGuide, guidesOf, removeGuide } from "../model/guides";
import { duplicateElements, elementBounds, selectionBounds, updatePage, withoutGroupOf, type Bounds } from "../model/edit";
import { endpointStep, guideStep, moveStep, NO_FEEDBACK, resizeStep, rotateStep, turnStep, type Drag, type DragStep, type Feedback, type MoveDrag } from "./canvasDragSteps";
import { intersects, snapIndexFor, type Point } from "./canvasGeometry";
import { openOnDoubleClick } from "./canvasDoubleClick";
import { applyCrop, useCropStore } from "./cropMode";
import type { RulerHandlers } from "./Rulers";
import { lineEndpoints, type LineEnd } from "./lineGeometry";
import type { Axis } from "./snapping";
import { boundsOf, type Handle } from "./transform";
import { currentPage, useStudioStore } from "./studioStore";
import { useSpacePan } from "./useSpacePan";
import { useViewPrefs } from "./viewPrefs";

const DRAG_THRESHOLD = 3;
const SNAP_PIXELS = 6;

type CanvasPointer = {
  viewportRef: RefObject<HTMLDivElement | null>;
  pageRef: RefObject<HTMLDivElement | null>;
  page: StudioPage;
  zoom: number;
  number: (points: number) => string;
  degrees: (angle: number) => string;
};

export function useCanvasPointer({ viewportRef, pageRef, page, zoom, number, degrees }: CanvasPointer) {
  const drag = useRef<Drag | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(NO_FEEDBACK);
  const [marquee, setMarquee] = useState<Bounds | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [turn, setTurn] = useState<{ box: Bounds; angle: number } | null>(null);
  const [movingGuide, setMovingGuide] = useState<{ index: number; removing: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  const { spaceHeld, panReady } = useSpacePan(() => {
    const current = drag.current;
    if (!current) return false;
    drag.current = null;
    setFeedback(NO_FEEDBACK);
    setMarquee(null);
    setTurn(null);
    setMovingGuide(null);
    setPanning(false);
    const state = useStudioStore.getState();
    if (current.kind === "marquee") state.select(current.base);
    else if (current.kind !== "pan") state.preview(() => current.before);
    state.setInteracting(false);
    if (current.kind === "move" && current.ids !== current.original) state.select(current.original);
    return true;
  });

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

  const startDuplicate = (current: MoveDrag) => {
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
    if (useCropStore.getState().session) {
      applyCrop();
      return;
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
    const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle as Handle | "rotate" | LineEnd | undefined;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (handle && state.design) {
      event.preventDefault();
      const elements = currentPage(state)?.elements.filter((element) => state.selection.includes(element.id) && !element.locked) ?? [];
      if (!elements.length) return;
      const origin = toPage(event.clientX, event.clientY);
      const start = boundsOf(elements) as Bounds;
      if (handle === "start" || handle === "end") {
        const element = elements[0];
        const end = lineEndpoints(element)[handle];
        drag.current = { kind: "endpoint", before: state.design, element, which: handle, grab: { x: end.x - origin.x, y: end.y - origin.y }, index: snapIndexFor(page, state.design, new Set(state.selection)) };
      } else if (handle === "rotate" && state.selection.length > 1) {
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
    if (current.kind !== "move") state.setInteracting(true);
    const context = { pageId: page.id, point, shiftKey: event.shiftKey, altKey: event.altKey, snap: snapping(event), tolerance, number, degrees };
    const apply = (step: DragStep) => {
      if (step.turn) setTurn(step.turn);
      setFeedback(step.feedback);
      state.preview(step.preview);
    };
    if (current.kind === "guide") {
      const view = viewportRef.current?.getBoundingClientRect();
      const removing = view ? (current.axis === "x" ? event.clientX < view.left : event.clientY < view.top) : false;
      current.removing = removing;
      setMovingGuide({ index: current.index, removing });
      apply(guideStep(current, context, removing));
      return;
    }
    if (current.kind === "move") {
      let dx = point.x - current.origin.x;
      let dy = point.y - current.origin.y;
      if (!current.moved && Math.hypot(dx, dy) * zoom < DRAG_THRESHOLD) return;
      if (!current.moved) {
        current.moved = true;
        state.setInteracting(true);
        if (current.duplicate) startDuplicate(current);
      }
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      apply(moveStep(current, context, { x: dx, y: dy }));
      return;
    }
    apply(current.kind === "rotate" ? rotateStep(current, context) : current.kind === "endpoint" ? endpointStep(current, context) : current.kind === "turn" ? turnStep(current, context) : resizeStep(current, context));
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
    store().setInteracting(false);
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

  const onDoubleClick = (event: ReactMouseEvent) => openOnDoubleClick(event, page);

  return {
    feedback,
    marquee,
    hover,
    setHover,
    turn,
    movingGuide,
    panReady,
    panning,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    rulerHandlers: { onPointerDown: onRulerPointerDown, onPointerMove, onPointerUp, onDoubleClick: onRulerDoubleClick } satisfies RulerHandlers,
  };
}
