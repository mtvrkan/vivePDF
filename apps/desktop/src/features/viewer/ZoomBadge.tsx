import { useEffect, useRef, useState } from "react";
import { useZoom } from "@embedpdf/plugin-zoom/react";

const SETTLE_MS = 1200;
const SHOW_MS = 900;

export function ZoomBadge({ documentId }: { documentId: string }) {
  const { state } = useZoom(documentId);
  const [visible, setVisible] = useState(false);
  const mountedAt = useRef(performance.now());
  const level = state.currentZoomLevel;

  useEffect(() => {
    if (performance.now() - mountedAt.current < SETTLE_MS) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [level]);

  if (!visible) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute end-4 bottom-4 z-30 rounded-md border border-(--glass-border) bg-card/95 px-2.5 py-1 font-mono text-xs tabular-nums shadow-(--shadow-float)"
    >
      {Math.round(level * 100)}%
    </div>
  );
}
