import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useThumbnailCapability } from "@embedpdf/plugin-thumbnail/react";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { appendDigit, emptyJumpState, isJumpDigit, jumpResetDelayMs, resolveJumpPage, type DigitJumpState } from "./pageJump";

const VISIBLE_MARGIN = "240px";

function GridThumb({ documentId, pageIndex, active, onSelect }: { documentId: string; pageIndex: number; active: boolean; onSelect: () => void }) {
  const { provides: thumbnailCapability } = useThumbnailCapability();
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const cellRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const node = cellRef.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: VISIBLE_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!thumbnailCapability || !visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const scope = thumbnailCapability.forDocument(documentId);
    void scope
      .renderThumb(pageIndex, window.devicePixelRatio || 1)
      .toPromise()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [thumbnailCapability, documentId, pageIndex, visible]);

  return (
    <button
      ref={cellRef}
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex flex-col items-center gap-1.5 rounded-xl p-2 transition-[box-shadow] duration-(--transition-fast)",
        active ? "glass-chip" : "hover:bg-white/5",
      )}
    >
      <span className={cn("flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-lg border-2 bg-black/40", active ? "border-primary" : "border-transparent group-hover:border-primary/40")}>
        {src ? <img src={src} alt="" className="h-full w-full object-contain" /> : null}
      </span>
      <span className={cn("font-mono text-xs tabular-nums", active ? "text-primary" : "text-muted-foreground")}>{pageIndex + 1}</span>
    </button>
  );
}

export function OverviewGrid({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const [jump, setJump] = useState<DigitJumpState>(emptyJumpState());
  const jumpTimer = useRef<number | null>(null);
  const pageIndexes = useMemo(() => Array.from({ length: scrollState.totalPages }, (_, index) => index), [scrollState.totalPages]);

  const goToPage = useCallback(
    (pageNumber: number) => {
      scroll?.scrollToPage({ pageNumber });
      onClose();
    },
    [scroll, onClose],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Enter") {
        const page = resolveJumpPage(jump, scrollState.totalPages);
        if (page !== null) {
          event.preventDefault();
          goToPage(page);
        }
        return;
      }
      if (isJumpDigit(event.key)) {
        event.preventDefault();
        setJump((current) => appendDigit(current, event.key));
        if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current);
        jumpTimer.current = window.setTimeout(() => setJump(emptyJumpState()), jumpResetDelayMs());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current);
    };
  }, [jump, scrollState.totalPages, goToPage, onClose]);

  const jumpTarget = resolveJumpPage(jump, scrollState.totalPages);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85" onMouseDown={onClose}>
      <div className="flex h-12 items-center justify-between px-5" onMouseDown={(event) => event.stopPropagation()}>
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">{t("presentation.overview")}</span>
        <IconButton icon={X} label={t("common.close")} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-8 pb-8" onMouseDown={(event) => event.stopPropagation()}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {pageIndexes.map((pageIndex) => (
            <GridThumb key={pageIndex} documentId={documentId} pageIndex={pageIndex} active={pageIndex + 1 === scrollState.currentPage} onSelect={() => goToPage(pageIndex + 1)} />
          ))}
        </div>
      </div>
      {jumpTarget !== null ? (
        <div aria-hidden className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground/85 px-3 py-1 font-mono text-sm text-background">
          {`→ ${jumpTarget}`}
        </div>
      ) : null}
    </div>
  );
}
