import { useCallback, useEffect, useMemo } from "react";
import { ChevronDown, ChevronUp, Columns2, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useViewportCapability } from "@embedpdf/plugin-viewport/react";
import { ZoomMode, useZoom } from "@embedpdf/plugin-zoom/react";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { Checkbox } from "@/components/tool/form";
import { PageView, type PageDecoration } from "@/features/viewer/PageView";
import { cn } from "@/shared/lib/cn";
import type { ChangeMark, PageDiff, SourceDocument } from "@/types";
import { isChanged, pageLabel } from "./changeFilter";
import { ChangeMarks } from "./ChangeMarks";
import { CompareViewSwitch, type CompareView } from "./CompareViewSwitch";
import { OverlayCompare } from "./OverlayCompare";
import { alignmentFrom, changePosition, nextChange, type AlignedRow } from "./pageAlignment";
import { useSideBySideDocuments } from "./useSideBySideDocuments";
import { describeError } from "@/shared/lib/errorMessage";

const FOLLOW_QUIET_MS = 150;

type SideBySideCompareProps = {
  active: boolean;
  sourceA: SourceDocument | null;
  sourceB: SourceDocument | null;
  pages: PageDiff[] | null;
  syncScroll: boolean;
  onSyncScrollChange: (value: boolean) => void;
  highlight: boolean;
  onHighlightChange: (value: boolean) => void;
  view: CompareView;
  onViewChange: (view: CompareView) => void;
};

type ScrollProvides = NonNullable<ReturnType<typeof useScroll>["provides"]>;

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

function PaneHeader({ fileName, currentPage, totalPages }: { fileName: string; currentPage: number; totalPages: number }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 glass-flat border-b px-3">
      <span className="min-w-0 flex-1 truncate text-sm" title={fileName}>{fileName}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{currentPage} / {totalPages}</span>
    </div>
  );
}

function topOfView(scroll: ScrollProvides): { pageNumber: number; x: number; y: number } | null {
  try {
    const visible = scroll.getMetrics().pageVisibilityMetrics;
    if (visible.length === 0) return null;
    const top = visible.reduce((best, item) => (item.viewportY < best.viewportY ? item : best));
    return { pageNumber: top.pageNumber, x: top.original.pageX, y: top.original.pageY };
  } catch {
    return null;
  }
}

function marksByPage(pages: PageDiff[] | null, side: "a" | "b"): Map<number, ChangeMark[]> {
  const byPage = new Map<number, ChangeMark[]>();
  for (const page of pages ?? []) {
    const number = side === "a" ? page.pageA : page.pageB;
    const marks = side === "a" ? page.marksA : page.marksB;
    if (number !== null && marks.length > 0) byPage.set(number - 1, marks);
  }
  return byPage;
}

type PanesProps = Omit<SideBySideCompareProps, "sourceA" | "sourceB" | "view" | "onViewChange"> & {
  idA: string;
  idB: string;
  sourceA: SourceDocument;
  sourceB: SourceDocument;
  viewSwitch: React.ReactNode;
};

export function SideBySideCompare({ active, sourceA, sourceB, pages, syncScroll, onSyncScrollChange, highlight, onHighlightChange, view, onViewChange }: SideBySideCompareProps) {
  const { t } = useTranslation();
  const pickedBoth = !!sourceA && !!sourceB && sourceA.path !== sourceB.path;
  const { idA, idB, status, error } = useSideBySideDocuments(sourceA, sourceB, active && view === "sideBySide");
  const viewSwitch = <CompareViewSwitch value={view} onChange={onViewChange} />;

  if (!pickedBoth || !sourceA || !sourceB) {
    return <EmptyState icon={Columns2} title={t("tools.compare.sideBySide.pickTitle")} description={t("tools.compare.sideBySide.pickHint")} />;
  }

  if (view === "overlay") {
    return <OverlayCompare active={active} sourceA={sourceA} sourceB={sourceB} pages={pages} viewSwitch={viewSwitch} />;
  }

  if (status === "loading" || status === "idle") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" aria-hidden />
        <p className="text-sm">{t("tools.compare.sideBySide.loading")}</p>
      </div>
    );
  }

  if (status === "error" || !idA || !idB) {
    return <ErrorState title={t("tools.failed")} message={error ? describeError(t, error) : t("tools.compare.sideBySide.openError")} />;
  }

  return (
    <SideBySidePanes
      active={active}
      idA={idA}
      idB={idB}
      sourceA={sourceA}
      sourceB={sourceB}
      pages={pages}
      syncScroll={syncScroll}
      onSyncScrollChange={onSyncScrollChange}
      highlight={highlight}
      onHighlightChange={onHighlightChange}
      viewSwitch={viewSwitch}
    />
  );
}

function SideBySidePanes({ active, idA, idB, sourceA, sourceB, pages, syncScroll, onSyncScrollChange, highlight, onHighlightChange, viewSwitch }: PanesProps) {
  const { t } = useTranslation();
  const { provides: viewport } = useViewportCapability();
  const { provides: scrollA, state: scrollStateA } = useScroll(idA);
  const { provides: scrollB, state: scrollStateB } = useScroll(idB);
  const { provides: zoomA, state: zoomStateA } = useZoom(idA);
  const { provides: zoomB } = useZoom(idB);

  const alignment = useMemo(() => alignmentFrom(pages, scrollStateA.totalPages, scrollStateB.totalPages), [pages, scrollStateA.totalPages, scrollStateB.totalPages]);
  const changes = useMemo<AlignedRow[]>(() => (pages ?? []).filter(isChanged).map((page) => ({ row: page.page, a: page.pageA, b: page.pageB })), [pages]);
  const marksA = useMemo(() => marksByPage(pages, "a"), [pages]);
  const marksB = useMemo(() => marksByPage(pages, "b"), [pages]);
  const hasMarks = marksA.size > 0 || marksB.size > 0;

  useEffect(() => {
    if (!syncScroll || !viewport || !scrollA || !scrollB) return;
    const scopeA = viewport.forDocument(idA);
    const scopeB = viewport.forDocument(idB);
    const quietUntil = { a: 0, b: 0 };
    const frames: number[] = [];
    const follow = (source: "a" | "b") => {
      if (performance.now() < quietUntil[source]) return;
      const target = source === "a" ? "b" : "a";
      quietUntil[target] = performance.now() + FOLLOW_QUIET_MS;
      frames.push(
        window.requestAnimationFrame(() => {
          const from = source === "a" ? scrollA : scrollB;
          const to = source === "a" ? scrollB : scrollA;
          const top = topOfView(from);
          if (!top) return;
          const page = source === "a" ? alignment.toB(top.pageNumber) : alignment.toA(top.pageNumber);
          if (page === null) return;
          quietUntil[target] = performance.now() + FOLLOW_QUIET_MS;
          to.scrollToPage({ pageNumber: page, pageCoordinates: { x: top.x, y: top.y }, behavior: "instant", alignX: 0, alignY: 0 });
        }),
      );
    };
    const unsubscribeA = scopeA.onScrollChange(() => follow("a"));
    const unsubscribeB = scopeB.onScrollChange(() => follow("b"));
    return () => {
      unsubscribeA();
      unsubscribeB();
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
    };
  }, [syncScroll, viewport, idA, idB, scrollA, scrollB, alignment]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollA?.scrollToNextPage();
        if (!syncScroll) scrollB?.scrollToNextPage();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollA?.scrollToPreviousPage();
        if (!syncScroll) scrollB?.scrollToPreviousPage();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, idA, idB, scrollA, scrollB, syncScroll]);

  const goToPage = useCallback(
    (spot: AlignedRow) => {
      if (spot.a) scrollA?.scrollToPage({ pageNumber: spot.a, behavior: "instant" });
      if (spot.b) scrollB?.scrollToPage({ pageNumber: spot.b, behavior: "instant" });
    },
    [scrollA, scrollB],
  );

  const currentRow = alignment.rowOfA(scrollStateA.currentPage) ?? scrollStateA.currentPage;
  const previous = nextChange(changes, currentRow, -1);
  const next = nextChange(changes, currentRow, 1);
  const position = changePosition(changes, currentRow);

  const alignPages = () => {
    const page = alignment.toB(scrollStateA.currentPage);
    if (page !== null) scrollB?.scrollToPage({ pageNumber: page, behavior: "instant" });
  };

  const zoomOut = () => {
    zoomA?.zoomOut();
    zoomB?.zoomOut();
  };
  const zoomIn = () => {
    zoomA?.zoomIn();
    zoomB?.zoomIn();
  };
  const fitWidth = () => {
    zoomA?.requestZoom(ZoomMode.FitWidth);
    zoomB?.requestZoom(ZoomMode.FitWidth);
  };

  const decorateA = useCallback<PageDecoration>((pageIndex, width, height) => (highlight ? <ChangeMarks marks={marksA.get(pageIndex)} side="a" width={width} height={height} /> : null), [highlight, marksA]);
  const decorateB = useCallback<PageDecoration>((pageIndex, width, height) => (highlight ? <ChangeMarks marks={marksB.get(pageIndex)} side="b" width={width} height={height} /> : null), [highlight, marksB]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-topbar flex-wrap items-center gap-1 glass-flat border-b px-2 py-1">
        {viewSwitch}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Checkbox label={t("tools.compare.sideBySide.sync")} checked={syncScroll} onChange={onSyncScrollChange} />
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button size="sm" variant="ghost" onClick={alignPages}>{t("tools.compare.sideBySide.align")}</Button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={ZoomOut} label={t("viewer.zoomOut")} onClick={zoomOut} />
        <span className="min-w-10 text-center font-mono text-xs tabular-nums text-muted-foreground">{Math.round(zoomStateA.currentZoomLevel * 100)}%</span>
        <IconButton icon={ZoomIn} label={t("viewer.zoomIn")} onClick={zoomIn} />
        <Button size="sm" variant="ghost" onClick={fitWidth}>{t("viewer.fitWidth")}</Button>
        {changes.length > 0 ? (
          <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Checkbox label={t(hasMarks ? "tools.compare.sideBySide.highlightMarks" : "tools.compare.sideBySide.highlight")} checked={highlight} onChange={onHighlightChange} />
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <IconButton icon={ChevronUp} label={t("tools.compare.sideBySide.previousChange")} disabled={!previous} onClick={() => previous && goToPage(previous)} />
            <span className="min-w-16 text-center font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {position > 0 ? t("tools.compare.sideBySide.changeOf", { current: position, total: changes.length }) : t("tools.compare.sideBySide.changeCount", { count: changes.length })}
            </span>
            <IconButton icon={ChevronDown} label={t("tools.compare.sideBySide.nextChange")} disabled={!next} onClick={() => next && goToPage(next)} />
          </>
        ) : null}
        <span className="flex-1" />
      </div>
      {highlight && changes.length > 0 ? (
        <div className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto border-b px-3 py-2">
          {changes.map((spot) => (
            <button
              key={spot.row}
              type="button"
              onClick={() => goToPage(spot)}
              aria-current={spot.row === currentRow ? "true" : undefined}
              className={cn(
                "h-7 rounded-md border px-2.5 font-mono text-xs tabular-nums text-foreground/80 transition-[background-color] duration-(--transition-fast) hover:text-foreground",
                spot.row === currentRow ? "glass-chip font-medium text-foreground" : "nav-glass",
              )}
            >
              {spot.a && spot.a === spot.b ? t("tools.compare.sideBySide.changedPage", { page: spot.a }) : pageLabel(spot.a, spot.b)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x">
        <div className="flex min-h-0 min-w-0 flex-col">
          <PaneHeader fileName={sourceA.fileName} currentPage={scrollStateA.currentPage} totalPages={scrollStateA.totalPages} />
          <div className="min-h-0 flex-1"><PageView documentId={idA} decoratePage={decorateA} /></div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          <PaneHeader fileName={sourceB.fileName} currentPage={scrollStateB.currentPage} totalPages={scrollStateB.totalPages} />
          <div className="min-h-0 flex-1"><PageView documentId={idB} decoratePage={decorateB} /></div>
        </div>
      </div>
    </div>
  );
}
