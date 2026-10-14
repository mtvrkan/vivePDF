import { useEffect, useRef, useState } from "react";
import { PdfErrorCode } from "@embedpdf/models";
import { useRegistry } from "@embedpdf/core/react";
import { pageTurns } from "@/features/viewer/overlay/pageSize";
import { cn } from "@/shared/lib/cn";
import { useBoxSize } from "./useBoxSize";

const SIZE_STEP_PX = 64;

type Preview = { pageIndex: number; url: string } | { pageIndex: number; url: null; failed: true };

function stepped(value: number): number {
  return Math.max(SIZE_STEP_PX, Math.ceil(value / SIZE_STEP_PX) * SIZE_STEP_PX);
}

export function NextPagePreview({ documentId, pageIndex, label, onSelect }: { documentId: string; pageIndex: number; label: string; onSelect: () => void }) {
  const { registry, documents } = useRegistry();
  const pdfDocument = documents[documentId]?.document ?? null;
  const frameRef = useRef<HTMLButtonElement>(null);
  const box = useBoxSize(frameRef);
  const [preview, setPreview] = useState<Preview | null>(null);
  const width = box.width > 0 ? stepped(box.width) : 0;
  const height = box.height > 0 ? stepped(box.height) : 0;

  useEffect(() => {
    const page = pdfDocument?.pages[pageIndex];
    if (!registry || !pdfDocument || !page || width === 0 || height === 0) return;
    const turns = pageTurns(documentId, pageIndex);
    const visible = turns % 2 === 1 ? { width: page.size.height, height: page.size.width } : page.size;
    const scaleFactor = Math.min(width / visible.width, height / visible.height);
    let url: string | null = null;
    let cancelled = false;
    const task = registry.getEngine().renderPageRect(pdfDocument, page, { origin: { x: 0, y: 0 }, size: page.size }, { scaleFactor, rotation: turns, dpr: window.devicePixelRatio || 1, withAnnotations: true });
    task.wait(
      (blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview({ pageIndex, url });
      },
      () => {
        if (!cancelled) setPreview((current) => (current?.pageIndex === pageIndex && current.url ? current : { pageIndex, url: null, failed: true }));
      },
    );
    return () => {
      cancelled = true;
      try {
        task.abort({ code: PdfErrorCode.Cancelled, message: "next page preview replaced" });
      } catch {
        return;
      }
    };
  }, [registry, pdfDocument, documentId, pageIndex, width, height]);

  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);

  const shown = preview?.pageIndex === pageIndex ? preview : null;

  return (
    <button
      ref={frameRef}
      type="button"
      aria-label={label}
      onClick={onSelect}
      data-testid="presenter-next-page"
      className="group relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-lg border bg-muted p-2 outline-none transition-[box-shadow] duration-(--transition-fast) hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {shown?.url ? (
        <img src={shown.url} alt="" className="max-h-full max-w-full object-contain shadow-(--shadow-card)" />
      ) : (
        <span aria-hidden className={cn("size-full rounded-md bg-card", shown ? null : "animate-pulse")} />
      )}
      <span className="absolute bottom-2 end-2 rounded-full bg-card px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground shadow-(--shadow-card)">{pageIndex + 1}</span>
    </button>
  );
}
