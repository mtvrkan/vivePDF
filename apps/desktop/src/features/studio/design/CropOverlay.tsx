import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { SliderField } from "@/components/tool/form";
import { isTextEntryTarget } from "@/shared/lib/typingTarget";
import type { StudioImageElement } from "@/types/studio";
import { flipTransform } from "../model/flip";
import { useImagePreview } from "./assets";
import { applyCrop, cancelCrop, updateDraft, useCropStore } from "./cropMode";
import { MAX_CROP_ZOOM, moveDraft, resetDraft, resizeFrame, toContent, zoomDraft, zoomOf, type CropDraft } from "./cropMath";
import { useImageFilter } from "./imageFilter";
import { currentPage, useStudioStore } from "./studioStore";
import { HANDLES, type Handle } from "./transform";

const NUDGE = 1;
const NUDGE_FAR = 10;
const WHEEL_STEP = 1.1;
const KEY_ZOOM_STEP = 1.25;
const DIM_OPACITY = 0.35;
const CURSORS: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

type Drag = { pointer: number; origin: { x: number; y: number }; start: CropDraft; handle: Handle | null };

function scaled(rect: { left: number; top: number; width: number; height: number }, zoom: number) {
  return { left: `${rect.left * zoom}px`, top: `${rect.top * zoom}px`, width: `${rect.width * zoom}px`, height: `${rect.height * zoom}px` };
}

function cursorOf(handle: Handle, draft: CropDraft): string {
  const mirrored = draft.flipX !== draft.flipY && handle.length === 2;
  if (!mirrored) return CURSORS[handle];
  return CURSORS[handle] === "nwse-resize" ? "nesw-resize" : "nwse-resize";
}

function handleSpot(handle: Handle, width: number, height: number) {
  return { x: handle.includes("e") ? width : handle.includes("w") ? 0 : width / 2, y: handle.includes("s") ? height : handle.includes("n") ? 0 : height / 2 };
}

function useCroppedElement(): StudioImageElement | null {
  const elementId = useCropStore((state) => state.session?.elementId ?? null);
  return useStudioStore((state) => {
    const element = elementId ? currentPage(state)?.elements.find((item) => item.id === elementId) : undefined;
    return element?.kind === "image" ? element : null;
  });
}

export function CropFrame({ zoom }: { zoom: number }) {
  const { t } = useTranslation();
  const session = useCropStore((state) => state.session);
  const element = useCroppedElement();
  const preview = useImagePreview(element?.src ?? null);
  const filter = useImageFilter(element?.filters);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const active = session !== null;

  useEffect(
    () =>
      useStudioStore.subscribe((state) => {
        const current = useCropStore.getState().session;
        if (!current) return;
        const page = currentPage(state);
        const target = page?.elements.find((item) => item.id === current.elementId);
        if (page?.id !== current.pageId || !target || target.locked || target.hidden || !state.selection.includes(current.elementId)) cancelCrop();
      }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!useCropStore.getState().session || event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const take = (action: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      };
      if (event.key === "Enter") return take(applyCrop);
      if (event.key === "Escape") return take(cancelCrop);
      const step = event.shiftKey ? NUDGE_FAR : NUDGE;
      const arrows: Record<string, { x: number; y: number }> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
      const arrow = arrows[event.key];
      if (arrow) return take(() => updateDraft((draft) => moveDraft(draft, toContent(arrow, draft))));
      if (event.key === "+" || event.key === "=") return take(() => updateDraft((draft) => zoomDraft(draft, zoomOf(draft) * KEY_ZOOM_STEP)));
      if (event.key === "-" || event.key === "_") return take(() => updateDraft((draft) => zoomDraft(draft, zoomOf(draft) / KEY_ZOOM_STEP)));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      updateDraft((draft) => zoomDraft(draft, zoomOf(draft) * (event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP)));
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [active]);

  if (!session || !element) return null;
  const draft = session.draft;
  const ready = preview?.status === "ready" ? preview.value : null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-crop-handle]")?.dataset.cropHandle as Handle | undefined;
    drag.current = { pointer: event.pointerId, origin: { x: event.clientX, y: event.clientY }, start: draft, handle: handle ?? null };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    event.stopPropagation();
    const delta = toContent({ x: (event.clientX - current.origin.x) / zoomRef.current, y: (event.clientY - current.origin.y) / zoomRef.current }, current.start);
    updateDraft(() => (current.handle ? resizeFrame(current.start, current.handle, delta) : moveDraft(current.start, delta)));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    drag.current = null;
  };

  const picture = ready ? <img src={ready.url} alt="" draggable={false} style={{ position: "absolute", maxWidth: "none", ...scaled(draft.image, zoom), filter: filter.css }} /> : null;

  return (
    <div
      ref={frameRef}
      data-testid="studio-crop-frame"
      role="group"
      aria-label={t("studio.crop.mode")}
      className="pointer-events-auto absolute cursor-move touch-none"
      style={{ left: draft.x * zoom, top: draft.y * zoom, width: draft.width * zoom, height: draft.height * zoom, transform: flipTransform(draft) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => {
        event.stopPropagation();
        applyCrop();
      }}
    >
      {filter.defs}
      {ready ? <div aria-hidden style={{ position: "absolute", inset: 0, opacity: DIM_OPACITY }}>{picture}</div> : <div aria-hidden className="absolute inset-0 animate-pulse bg-muted" />}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {picture}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 border-2 border-primary" />
      {HANDLES.map((handle) => {
        const spot = handleSpot(handle, draft.width * zoom, draft.height * zoom);
        return (
          <span
            key={handle}
            data-crop-handle={handle}
            aria-hidden
            className="absolute size-3 rounded-sm border-2 border-primary bg-background"
            style={{ left: spot.x - 6, top: spot.y - 6, cursor: cursorOf(handle, draft) }}
          />
        );
      })}
    </div>
  );
}

export function CropBar() {
  const { t } = useTranslation();
  const session = useCropStore((state) => state.session);
  if (!session) return null;
  const zoom = zoomOf(session.draft);
  return (
    <div role="toolbar" aria-label={t("studio.crop.mode")} data-testid="studio-crop-bar" className="glass absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border/60 px-3 py-2 shadow-lg">
      <SliderField
        className="w-44"
        label={t("studio.crop.zoom")}
        value={Math.round(zoom * 100)}
        min={100}
        max={MAX_CROP_ZOOM * 100}
        step={5}
        format={(value) => `${value}%`}
        onChange={(value) => updateDraft((draft) => zoomDraft(draft, value / 100))}
      />
      <span className="hidden max-w-56 text-xs text-muted-foreground xl:inline">{t("studio.crop.hint")}</span>
      <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => updateDraft((draft, current) => resetDraft(draft, current.natural))}>
        {t("studio.crop.reset")}
      </Button>
      <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={cancelCrop} aria-keyshortcuts="Escape">
        {t("studio.crop.cancel")}
      </Button>
      <Button size="sm" variant="primary" icon={<Check className="size-4" aria-hidden />} onClick={applyCrop} aria-keyshortcuts="Enter">
        {t("studio.crop.done")}
      </Button>
    </div>
  );
}
