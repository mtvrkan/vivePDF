import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { isControlTarget, isTextEntryTarget } from "@/shared/lib/typingTarget";
import type { StudioDesign, StudioElement, StudioPage, StudioTextElement } from "@/types/studio";
import { openGraphic } from "../graphics/graphicEditor";
import { addGuide, guidesOf, moveGuide, removeGuide } from "../model/guides";
import { duplicateElements, elementBounds, selectionBounds, updateElement, updatePage, moveElements, withoutGroupOf, type Bounds } from "../model/edit";
import { intersects, snapIndexFor, type Point } from "./canvasGeometry";
import type { Readout } from "./CanvasMarks";
import { applyCrop, beginCrop, croppable, useCropStore } from "./cropMode";
import type { RulerHandlers } from "./Rulers";
import { lineEndpoints, moveLineEnd, type LineEnd } from "./lineGeometry";
import { measureAround, snapMove, snapPoint, snapPosition, snapResize, type Axis, type SnapIndex, type SnapLine, type Span } from "./snapping";
import { textEditorEntry } from "./textEditorBridge";
import { boundsOf, ratioLocked, resizeBox, rotateElements, rotationFromPointer, scaleElements, turnFromPointer, type Handle } from "./transform";
import { currentPage, useStudioStore } from "./studioStore";
import { useViewPrefs } from "./viewPrefs";

const DRAG_THRESHOLD = 3;
const SNAP_PIXELS = 6;

type Drag =
  | { kind: "move"; before: StudioDesign; base: StudioDesign; ids: string[]; original: string[]; origin: Point; moved: boolean; duplicate: boolean; index: SnapIndex; start: Bounds; anchor: Point }
  | { kind: "resize"; before: StudioDesign; handle: Handle; elements: StudioElement[]; origin: Point; start: Bounds; index: SnapIndex }
  | { kind: "rotate"; before: StudioDesign; element: StudioElement }
  | { kind: "endpoint"; before: StudioDesign; element: StudioElement; which: LineEnd; grab: Point; index: SnapIndex }
  | { kind: "turn"; before: StudioDesign; elements: StudioElement[]; centre: Point; origin: Point; box: Bounds }
  | { kind: "guide"; before: StudioDesign; pageId: string; index: number; axis: Axis; created: boolean; removing: boolean; snap: SnapIndex }
  | { kind: "marquee"; origin: Point; base: string[] }
  | { kind: "pan"; origin: Point; scroll: Point };

export type Feedback = { lines: SnapLine[]; gaps: Span[]; distances: Span[]; readout: Readout | null };

const NO_FEEDBACK: Feedback = { lines: [], gaps: [], distances: [], readout: null };

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
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const spaceHeld = useRef(false);

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
        state.setInteracting(false);
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
        state.setInteracting(true);
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
    if (current.kind === "endpoint") {
      const raw = { x: point.x + current.grab.x, y: point.y + current.grab.y };
      const snapped = !event.shiftKey && snapping(event) ? snapPoint(current.index, raw, tolerance) : { ...raw, lines: [] };
      const patch = moveLineEnd(current.element, current.which, snapped, { step: event.shiftKey });
      setFeedback({ ...NO_FEEDBACK, lines: snapped.lines, readout: { text: `${number(patch.width)} mm  ${degrees(patch.rotation)}`, x: point.x, y: point.y } });
      state.preview(() => updatePage(current.before, page.id, (item) => updateElement<StudioElement>(item, current.element.id, patch)));
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
      const keepRatio = corner && (ratioLocked(element) ? !event.shiftKey : event.shiftKey);
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

  const onDoubleClick = (event: React.MouseEvent) => {
    const guide = (event.target as HTMLElement).closest<HTMLElement>("[data-guide]");
    if (guide) {
      const index = Number(guide.dataset.guide);
      store().applyToPage((current) => removeGuide(current, index));
      return;
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    const element = page.elements.find((item) => item.id === hit);
    const state = store();
    if (element && element.groupId !== null && !(state.groupScope === element.groupId && state.selection.includes(element.id))) {
      state.enterGroup(element.id);
      return;
    }
    if (element && openGraphic(element, { x: event.clientX, y: event.clientY })) return;
    if (element?.kind === "text" && !element.locked) {
      store().select([element.id]);
      textEditorEntry.point = { x: event.clientX, y: event.clientY };
      store().setEditing(element.id);
    }
    if (croppable(element)) void beginCrop(element);
  };

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
