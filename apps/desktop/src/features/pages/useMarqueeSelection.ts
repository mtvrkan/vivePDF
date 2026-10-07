import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createLiveValue } from "./liveValue";

const START_THRESHOLD = 4;
const EDGE_ZONE = 40;
const SCROLL_STEP = 16;

export type MarqueeMode = "replace" | "add" | "toggle";
export type MarqueeBox = { left: number; top: number; width: number; height: number };

type Point = { x: number; y: number };

export type TileRect = { key: string; rect: MarqueeBox };

type Session = {
  pointerId: number;
  origin: Point;
  client: Point;
  mode: MarqueeMode;
  base: ReadonlySet<string>;
  active: boolean;
  stale: boolean;
  hits: string | null;
};

type UseMarqueeSelectionOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLElement | null>;
  tilesNear: (box: MarqueeBox) => TileRect[];
  selected: ReadonlySet<string>;
  onSelect: (keys: Set<string>) => void;
};

export function marqueeModeOf(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): MarqueeMode {
  if (event.ctrlKey || event.metaKey) return "toggle";
  if (event.shiftKey) return "add";
  return "replace";
}

export function boxBetween(a: Point, b: Point): MarqueeBox {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function intersects(box: MarqueeBox, rect: MarqueeBox): boolean {
  return box.left < rect.left + rect.width && box.left + box.width > rect.left && box.top < rect.top + rect.height && box.top + box.height > rect.top;
}

export function combineSelection(base: ReadonlySet<string>, hits: Iterable<string>, mode: MarqueeMode): Set<string> {
  if (mode === "replace") return new Set(hits);
  const next = new Set(base);
  for (const key of hits) {
    if (mode === "toggle" && base.has(key)) next.delete(key);
    else next.add(key);
  }
  return next;
}

export function hitKeys(box: MarqueeBox, tiles: TileRect[]): string[] {
  return tiles.filter((tile) => intersects(box, tile.rect)).map((tile) => tile.key);
}

function sameBox(left: MarqueeBox | null, right: MarqueeBox): boolean {
  return left !== null && left.left === right.left && left.top === right.top && left.width === right.width && left.height === right.height;
}

function contentPoint(container: HTMLElement, clientX: number, clientY: number): Point {
  const rect = container.getBoundingClientRect();
  return { x: clientX - rect.left + container.scrollLeft, y: clientY - rect.top + container.scrollTop };
}

export function useMarqueeSelection({ scrollRef, gridRef, tilesNear, selected, onSelect }: UseMarqueeSelectionOptions) {
  const [active, setActive] = useState(false);
  const [box] = useState(() => createLiveValue<MarqueeBox>());
  const sessionRef = useRef<Session | null>(null);
  const frameRef = useRef<number | null>(null);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const tilesNearRef = useRef(tilesNear);
  selectedRef.current = selected;
  onSelectRef.current = onSelect;
  tilesNearRef.current = tilesNear;

  const stopScrolling = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  const update = useCallback(() => {
    const container = scrollRef.current;
    const session = sessionRef.current;
    if (!container || !session) return;
    const current = contentPoint(container, session.client.x, session.client.y);
    if (!session.active) {
      if (Math.hypot(current.x - session.origin.x, current.y - session.origin.y) < START_THRESHOLD) return;
      session.active = true;
    }
    const next = boxBetween(session.origin, current);
    if (!sameBox(box.get(), next)) box.set(next);
    setActive(true);
    const hits = hitKeys(next, tilesNearRef.current(next));
    const signature = hits.join(" ");
    if (signature === session.hits) return;
    session.hits = signature;
    onSelectRef.current(combineSelection(session.base, hits, session.mode));
  }, [scrollRef, box]);

  const scrollNearEdges = useCallback(() => {
    const container = scrollRef.current;
    const session = sessionRef.current;
    if (!container || !session) {
      stopScrolling();
      return;
    }
    if (session.active) {
      const rect = container.getBoundingClientRect();
      const { y } = session.client;
      const before = container.scrollTop;
      if (y < rect.top + EDGE_ZONE) container.scrollTop -= SCROLL_STEP;
      else if (y > rect.bottom - EDGE_ZONE) container.scrollTop += SCROLL_STEP;
      if (container.scrollTop !== before) session.stale = true;
    }
    if (session.stale) {
      session.stale = false;
      update();
    }
    frameRef.current = requestAnimationFrame(scrollNearEdges);
  }, [scrollRef, update]);

  const finish = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    stopScrolling();
    box.set(null);
    setActive(false);
    if (session && !session.active && session.mode === "replace") onSelectRef.current(new Set());
  }, [box]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const container = scrollRef.current;
      if (!container || event.button !== 0 || event.pointerType === "touch") return;
      const target = event.target as Element;
      if (target.closest("[data-tile-key], [data-no-marquee], button, input, a, [role='dialog']")) return;
      const rect = container.getBoundingClientRect();
      if (event.clientX - rect.left >= container.clientWidth || event.clientY - rect.top >= container.clientHeight) return;
      event.preventDefault();
      gridRef.current?.focus({ preventScroll: true });
      container.setPointerCapture(event.pointerId);
      sessionRef.current = {
        pointerId: event.pointerId,
        origin: contentPoint(container, event.clientX, event.clientY),
        client: { x: event.clientX, y: event.clientY },
        mode: marqueeModeOf(event),
        base: new Set(selectedRef.current),
        active: false,
        stale: false,
        hits: null,
      };
      stopScrolling();
      frameRef.current = requestAnimationFrame(scrollNearEdges);
    },
    [scrollRef, gridRef, scrollNearEdges],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      session.client = { x: event.clientX, y: event.clientY };
      session.stale = true;
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (session.stale) update();
      finish();
    },
    [finish, update],
  );

  const onScroll = useCallback(() => {
    const session = sessionRef.current;
    if (session?.active) session.stale = true;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const session = sessionRef.current;
      if (event.key !== "Escape" || !session) return;
      event.stopPropagation();
      onSelectRef.current(new Set(session.base));
      session.active = true;
      finish();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      stopScrolling();
    };
  }, [finish]);

  return { active, box, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onScroll } };
}
