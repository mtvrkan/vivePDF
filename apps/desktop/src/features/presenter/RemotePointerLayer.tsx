import { useEffect, useRef, useState } from "react";
import { MousePointer2, Plus, TextCursor } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { LiveStrokeCanvas } from "@/features/viewer/presentation/DrawingLayer";
import { LaserTrail, type LaserPoint } from "@/features/viewer/presentation/LaserTrail";
import { fromLivePoint, liveScale, type LiveSignal } from "@/features/viewer/presentation/liveSignal";
import { MagnifierLens } from "@/features/viewer/presentation/MagnifierLens";
import { ERASER_CURSOR_COLOR, eraserCursorArt, highlighterCursorArt, penCursorArt, TOOL_CURSOR_SIZE, type ToolCursorArt } from "@/features/viewer/presentation/toolCursor";
import { pageRectAt, type PageRect } from "@/features/viewer/presentation/usePageRects";
import type { PresentationTool } from "@/shared/store/presentationStore";

const SPOTLIGHT_RECT_RATIO = 0.42;
const LASER_FADE_MS = 700;
const CURSOR_SIZE_PX = 22;
const MIN_CURSOR_SIZE_PX = 16;
const LENS_TOOLS = new Set(["laser", "spotlight", "magnifier"]);
const FALLBACK_INK = "#E5484D";

function inkArt(tool: PresentationTool, color: string): ToolCursorArt | null {
  if (tool === "pen") return penCursorArt(color);
  if (tool === "highlighter") return highlighterCursorArt(color);
  if (tool === "eraser") return eraserCursorArt(ERASER_CURSOR_COLOR);
  return null;
}

function RemoteCursor({ tool, x, y, scale, color }: { tool: PresentationTool; x: number; y: number; scale: number; color: string }) {
  const zoom = Math.max(MIN_CURSOR_SIZE_PX / CURSOR_SIZE_PX, scale);
  const art = inkArt(tool, color);
  if (art) {
    const size = TOOL_CURSOR_SIZE * zoom;
    return (
      <img
        aria-hidden
        alt=""
        src={art.src}
        data-remote-cursor={tool}
        draggable={false}
        className="absolute max-w-none select-none"
        style={{ left: x - art.hotX * zoom, top: y - art.hotY * zoom, width: size, height: size }}
      />
    );
  }
  const size = CURSOR_SIZE_PX * zoom;
  if (tool === "text" || tool === "shape") {
    const Icon = tool === "text" ? TextCursor : Plus;
    return <Icon aria-hidden data-remote-cursor={tool} className="absolute -translate-x-1/2 -translate-y-1/2 fill-white stroke-black drop-shadow-md" strokeWidth={2} style={{ left: x, top: y, width: size, height: size }} />;
  }
  return <MousePointer2 aria-hidden data-remote-cursor={tool} className="absolute fill-white stroke-black drop-shadow-md" strokeWidth={1.5} style={{ left: x, top: y, width: size, height: size }} />;
}

function mapPath(rects: PageRect[], signal: LiveSignal | null): LaserPoint[] | null {
  if (!signal?.laserPath) return null;
  return signal.laserPath.map((point) => fromLivePoint(rects, point)).filter((point): point is LaserPoint => point !== null);
}

export function RemotePointerLayer({ signal, rects }: { signal: LiveSignal | null; rects: PageRect[] }) {
  const laserColor = usePresentationStore((state) => state.laserColor);
  const laserSize = usePresentationStore((state) => state.laserSize);
  const spotlightRadius = usePresentationStore((state) => state.spotlightRadius);
  const spotlightShape = usePresentationStore((state) => state.spotlightShape);
  const spotlightDim = usePresentationStore((state) => state.spotlightDim);
  const [fading, setFading] = useState<{ id: number; points: LaserPoint[] } | null>(null);
  const lastPath = useRef<LaserPoint[] | null>(null);
  const fadeId = useRef(0);
  const fadeTimer = useRef<number | null>(null);

  const scale = signal ? liveScale(rects, signal) : 1;
  const pointer = signal?.pointer ? fromLivePoint(rects, signal.pointer) : null;
  const laserPath = mapPath(rects, signal);

  useEffect(
    () => () => {
      if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    },
    [],
  );

  useEffect(() => {
    const path = mapPath(rects, signal);
    if (path && path.length > 1) {
      lastPath.current = path;
      return;
    }
    const released = lastPath.current;
    lastPath.current = null;
    if (!released) return;
    fadeId.current += 1;
    const id = fadeId.current;
    setFading({ id, points: released });
    if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => {
      fadeTimer.current = null;
      setFading((current) => (current?.id === id ? null : current));
    }, LASER_FADE_MS);
  }, [signal, rects]);

  const tool = signal?.tool;
  const size = laserSize * scale;
  const radius = spotlightRadius * scale;
  const strokeRect = signal?.activeStroke ? rects.find((rect) => rect.pageIndex === signal.activeStroke?.pageIndex) : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" data-remote-pointer="">
      {signal?.activeStroke && strokeRect ? <LiveStrokeCanvas rect={strokeRect} stroke={signal.activeStroke.stroke} /> : null}
      {tool === "laser" && laserPath && laserPath.length > 1 ? <LaserTrail points={laserPath} color={laserColor} size={size} contained /> : null}
      {fading ? <LaserTrail key={fading.id} points={fading.points} color={laserColor} size={size} contained fading /> : null}
      {tool === "laser" && pointer ? (
        <span
          aria-hidden
          data-remote-laser=""
          className="laser-dot absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: pointer.x,
            top: pointer.y,
            width: size,
            height: size,
            background: `radial-gradient(circle, ${laserColor} 0%, transparent 70%)`,
            boxShadow: `0 0 ${size}px ${size / 2}px ${laserColor}88`,
          }}
        />
      ) : null}
      {tool === "spotlight" && pointer ? (
        <div
          aria-hidden
          data-remote-spotlight=""
          className={cn("absolute", spotlightShape === "circle" ? "rounded-full" : "rounded-xl")}
          style={{
            left: pointer.x - radius,
            top: pointer.y - (spotlightShape === "circle" ? radius : radius * SPOTLIGHT_RECT_RATIO),
            width: radius * 2,
            height: spotlightShape === "circle" ? radius * 2 : radius * SPOTLIGHT_RECT_RATIO * 2,
            boxShadow: `0 0 0 9999px rgba(0,0,0,${spotlightDim})`,
          }}
        />
      ) : null}
      {tool && !LENS_TOOLS.has(tool) && pointer ? <RemoteCursor tool={tool} x={pointer.x} y={pointer.y} scale={scale} color={signal?.cursorColor ?? FALLBACK_INK} /> : null}
      {tool === "magnifier" && pointer ? <MagnifierLens x={pointer.x} y={pointer.y} pageRect={pageRectAt(rects, pointer.x, pointer.y)} /> : null}
    </div>
  );
}
