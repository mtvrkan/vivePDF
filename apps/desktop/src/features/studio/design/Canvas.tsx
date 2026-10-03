import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { ArrowDownToLine, ArrowUpToLine, ClipboardPaste, Copy, CopyPlus, Group, Lock, Scissors, Trash2, Ungroup } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { cn } from "@/shared/lib/cn";
import type { StudioDesign, StudioElement, StudioTextElement } from "@/types/studio";
import { elementBounds, selectionBounds, updateElement, moveElements, type Bounds } from "../model/edit";
import { canGroup, canUngroup, group, reorder, toggleLock, ungroup } from "./commands";
import { ElementView, PageView } from "./ElementView";
import { pickImage } from "./pickImage";
import { TextEditor } from "./TextEditor";
import { HANDLES, boundsOf, resizeBox, rotationFromPointer, scaleBoundsByHandle, scaleElements, snapBounds, snapTargets, type Guide, type Handle } from "./transform";
import { currentPage, useStudioStore } from "./studioStore";

const PAD = 48;
const DRAG_THRESHOLD = 3;
const SNAP_PIXELS = 6;
const ZOOM_STEP = 1.1;

type Point = { x: number; y: number };
type Drag =
  | { kind: "move"; before: StudioDesign; ids: string[]; origin: Point; moved: boolean; targets: ReturnType<typeof snapTargets>; start: Bounds }
  | { kind: "resize"; before: StudioDesign; handle: Handle; elements: StudioElement[]; origin: Point; start: Bounds }
  | { kind: "rotate"; before: StudioDesign; element: StudioElement }
  | { kind: "marquee"; origin: Point; base: string[] };

const CURSORS: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

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

export function Canvas({ language }: { language: string }) {
  const { t } = useTranslation();
  const design = useStudioStore((state) => state.design);
  const page = useStudioStore((state) => currentPage(state));
  const selection = useStudioStore((state) => state.selection);
  const editingId = useStudioStore((state) => state.editingId);
  const zoom = useStudioStore((state) => state.zoom);
  const fit = useStudioStore((state) => state.fit);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const zoomAnchor = useRef<{ page: Point; client: Point } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Bounds | null>(null);
  const menu = useContextMenu();

  const selected = useMemo(() => (page ? page.elements.filter((element) => selection.includes(element.id)) : []), [page, selection]);

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

  const beginMove = (event: ReactPointerEvent, ids: string[]) => {
    const state = store();
    const current = currentPage(state);
    if (!state.design || !current) return;
    const chosen = new Set(ids);
    const others = current.elements.filter((element) => !chosen.has(element.id) && !element.hidden).map(elementBounds);
    drag.current = {
      kind: "move",
      before: state.design,
      ids,
      origin: toPage(event.clientX, event.clientY),
      moved: false,
      targets: snapTargets(current.width, current.height, others),
      start: selectionBounds(current, ids) ?? { x: 0, y: 0, width: 0, height: 0 },
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle as Handle | "rotate" | undefined;
    const state = store();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (handle && state.design) {
      event.preventDefault();
      const elements = currentPage(state)?.elements.filter((element) => state.selection.includes(element.id) && !element.locked) ?? [];
      if (!elements.length) return;
      if (handle === "rotate") drag.current = { kind: "rotate", before: state.design, element: elements[0] };
      else drag.current = { kind: "resize", before: state.design, handle, elements, origin: toPage(event.clientX, event.clientY), start: boundsOf(elements) as Bounds };
      return;
    }
    const hit = target.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    if (state.editingId && hit !== state.editingId) state.setEditing(null);
    if (hit) {
      const ids = state.selection.includes(hit) ? state.selection : [hit];
      const next = event.shiftKey ? (state.selection.includes(hit) ? state.selection.filter((id) => id !== hit) : [...state.selection, hit]) : ids;
      state.select(next);
      beginMove(event, store().selection);
      return;
    }
    const origin = toPage(event.clientX, event.clientY);
    if (!event.shiftKey) state.select([]);
    drag.current = { kind: "marquee", origin, base: event.shiftKey ? state.selection : [] };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const point = toPage(event.clientX, event.clientY);
    const state = store();
    if (current.kind === "marquee") {
      const box = { x: Math.min(point.x, current.origin.x), y: Math.min(point.y, current.origin.y), width: Math.abs(point.x - current.origin.x), height: Math.abs(point.y - current.origin.y) };
      setMarquee(box);
      const hits = currentPage(state)?.elements.filter((element) => !element.hidden && intersects(elementBounds(element), box)).map((element) => element.id) ?? [];
      state.select([...new Set([...current.base, ...hits])]);
      return;
    }
    if (current.kind === "move") {
      let dx = point.x - current.origin.x;
      let dy = point.y - current.origin.y;
      if (!current.moved && Math.hypot(dx, dy) * zoom < DRAG_THRESHOLD) return;
      current.moved = true;
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      let shown: Guide[] = [];
      if (!event.ctrlKey) {
        const snapped = snapBounds({ ...current.start, x: current.start.x + dx, y: current.start.y + dy }, current.targets, SNAP_PIXELS / zoom);
        dx += snapped.dx;
        dy += snapped.dy;
        shown = snapped.guides;
      }
      setGuides(shown);
      const ids = current.ids;
      state.preview(() => ({ ...current.before, pages: current.before.pages.map((item) => (item.id === page.id ? moveElements(item, ids, dx, dy) : item)) }));
      return;
    }
    if (current.kind === "rotate") {
      const element = current.element;
      const rotation = rotationFromPointer({ x: element.x + element.width / 2, y: element.y + element.height / 2 }, point, { step: event.shiftKey });
      state.preview(() => ({ ...current.before, pages: current.before.pages.map((item) => (item.id === page.id ? updateElement(item, element.id, { rotation }) : item)) }));
      return;
    }
    const dx = point.x - current.origin.x;
    const dy = point.y - current.origin.y;
    const corner = current.handle.length === 2;
    if (current.elements.length === 1) {
      const element = current.elements[0];
      const keepRatio = corner && (element.kind === "text" || element.kind === "image" || element.kind === "qr" ? !event.shiftKey : event.shiftKey);
      const box = resizeBox(element, current.handle, dx, dy, { keepRatio, fromCenter: event.altKey });
      const patch: Partial<StudioElement> = { x: box.x, y: box.y, width: box.width, height: box.height };
      if (element.kind === "text" && corner && keepRatio) (patch as Partial<StudioTextElement>).fontSize = Math.max(1, Math.min(1000, element.fontSize * (box.width / element.width)));
      if (element.kind === "qr") patch.height = box.width;
      state.preview(() => ({ ...current.before, pages: current.before.pages.map((item) => (item.id === page.id ? updateElement(item, element.id, patch) : item)) }));
      return;
    }
    const target = scaleBoundsByHandle(current.start, current.handle, dx, dy, !event.shiftKey);
    const scaled = scaleElements(current.elements, current.start, target);
    state.preview(() => ({
      ...current.before,
      pages: current.before.pages.map((item) => (item.id === page.id ? scaled.reduce((acc, element) => updateElement<StudioElement>(acc, element.id, element), item) : item)),
    }));
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    setGuides([]);
    setMarquee(null);
    if (!current || current.kind === "marquee") return;
    if (current.kind === "move" && !current.moved) return;
    store().settle(current.before);
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    const element = page.elements.find((item) => item.id === hit);
    if (element?.kind === "text" && !element.locked) {
      store().select([element.id]);
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
    { type: "separator", id: "s1" },
    { type: "item", id: "front", label: t("studio.menu.front"), icon: ArrowUpToLine, shortcut: "Ctrl+Shift+]", disabled: !selection.length, onSelect: () => reorder("front") },
    { type: "item", id: "back", label: t("studio.menu.back"), icon: ArrowDownToLine, shortcut: "Ctrl+Shift+[", disabled: !selection.length, onSelect: () => reorder("back") },
    { type: "item", id: "group", label: t("studio.menu.group"), icon: Group, shortcut: "Ctrl+G", disabled: !canGroup(), onSelect: group },
    { type: "item", id: "ungroup", label: t("studio.menu.ungroup"), icon: Ungroup, shortcut: "Ctrl+Shift+G", disabled: !canUngroup(), onSelect: ungroup },
    { type: "item", id: "lock", label: t("studio.menu.lock"), icon: Lock, checked: selected.length > 0 && selected.every((element) => element.locked), disabled: !selection.length, onSelect: toggleLock },
    { type: "separator", id: "s2" },
    { type: "item", id: "delete", label: t("studio.menu.delete"), icon: Trash2, shortcut: "Delete", disabled: !selection.length, onSelect: state.remove },
  ];

  const frame = selected.length === 1 ? selected[0] : null;
  const groupBox = selected.length > 1 ? boundsOf(selected) : null;
  const showHandles = !editingId && selected.length > 0 && selected.some((element) => !element.locked);

  return (
    <div
      ref={viewportRef}
      data-testid="studio-viewport"
      className="relative min-h-0 flex-1 overflow-auto bg-muted/40"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
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
          style={{ left: `max(${PAD}px, calc(50% - ${(page.width * zoom) / 2}px))`, top: `${PAD}px`, width: `${page.width * zoom}px`, height: `${page.height * zoom}px` }}
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
          <div className="pointer-events-none absolute inset-0">
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
                    <span aria-hidden className="absolute left-1/2 h-4 w-px bg-primary" style={{ top: -18 }} />
                    <span data-handle="rotate" aria-hidden className="pointer-events-auto absolute left-1/2 size-4 -translate-x-1/2 cursor-grab rounded-full border-2 border-primary bg-background" style={{ top: -30 }} />
                  </>
                ) : null}
              </div>
            ) : null}
            {groupBox ? (
              <div data-testid="studio-selection" className="absolute border-2 border-dashed border-primary" style={{ left: groupBox.x * zoom, top: groupBox.y * zoom, width: groupBox.width * zoom, height: groupBox.height * zoom }}>
                {showHandles
                  ? handlesFor(selected).map((handle) => {
                      const spot = handlePosition(handle, groupBox.width * zoom, groupBox.height * zoom);
                      return <span key={handle} data-handle={handle} aria-hidden className="pointer-events-auto absolute size-3 rounded-full border-2 border-primary bg-background" style={{ left: spot.x - 6, top: spot.y - 6, cursor: CURSORS[handle] }} />;
                    })
                  : null}
              </div>
            ) : null}
            {guides.map((guide, index) =>
              guide.axis === "x" ? (
                <div key={index} className="absolute w-px bg-destructive" style={{ left: guide.position * zoom, top: Math.min(0, guide.from) * zoom, height: Math.max(page.height, guide.to) * zoom }} />
              ) : (
                <div key={index} className="absolute h-px bg-destructive" style={{ top: guide.position * zoom, left: Math.min(0, guide.from) * zoom, width: Math.max(page.width, guide.to) * zoom }} />
              ),
            )}
            {marquee ? <div className="absolute border border-primary bg-primary/10" style={{ left: marquee.x * zoom, top: marquee.y * zoom, width: marquee.width * zoom, height: marquee.height * zoom }} /> : null}
          </div>
        </div>
      </div>
      {menu.anchor ? <ContextMenu anchor={menu.anchor} items={menuItems} label={t("studio.menu.label")} onClose={menu.close} /> : null}
    </div>
  );
}
