import { useLayoutEffect, useRef } from "react";
import type { LiveValue } from "./liveValue";
import type { MarqueeBox } from "./useMarqueeSelection";

export function MarqueeRect({ live }: { live: LiveValue<MarqueeBox> }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(
    () =>
      live.subscribe((box) => {
        const element = ref.current;
        if (!element || !box) return;
        element.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
        element.style.width = `${box.width}px`;
        element.style.height = `${box.height}px`;
      }),
    [live],
  );

  return <div ref={ref} aria-hidden className="pointer-events-none absolute top-0 left-0 z-20 rounded-sm border border-primary bg-primary/15 will-change-transform" />;
}

export function DragBadge({ live, label }: { live: LiveValue<{ x: number; y: number }>; label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(
    () =>
      live.subscribe((point) => {
        const element = ref.current;
        if (!element || !point) return;
        element.style.transform = `translate3d(${point.x + 12}px, ${point.y + 12}px, 0)`;
      }),
    [live],
  );

  return (
    <div ref={ref} aria-hidden className="pointer-events-none fixed top-0 left-0 z-50 rounded-lg border bg-card px-2.5 py-1 font-mono text-xs shadow-(--shadow-float) will-change-transform">
      {label}
    </div>
  );
}
