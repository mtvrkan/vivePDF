import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight, CornerUpLeft, FileDown, Moon, Pause, Play, RotateCcw, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { ImmersiveView } from "@/features/viewer/ImmersiveView";
import { exitImmersiveSavingDrawings } from "@/features/viewer/immersive";
import { TemporaryDrawingCleanup } from "@/features/viewer/presentation/DrawingCleanupButton";
import { formatElapsed } from "@/features/viewer/presentation/elapsed";
import { PresentationInsertMenu } from "@/features/viewer/presentation/PresentationInsertMenu";
import { PresentationStyleControls, PresentationStyleTrigger, PresentationToolButtons } from "@/features/viewer/presentation/PresentationTools";
import { hasStyleOptions } from "@/features/viewer/presentation/toolPresets";
import { useOutsideDismiss } from "@/shared/hooks/useOutsideDismiss";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useToastStore } from "@/shared/store/toastStore";
import { fitBox } from "./fitBox";
import { NextPagePreview } from "./NextPagePreview";
import { NotesEditor } from "./NotesEditor";
import type { PresenterTransport } from "./presenterChannel";
import { reopenAudience, swapScreens, usePresenterStore } from "./presenterSession";
import { useBoxSize } from "./useBoxSize";
import { usePresenterConsole } from "./usePresenterConsole";
import { sessionPathOf } from "@/features/viewer/convertedDocuments";

const TIMER_TICK_MS = 500;
const CLOCK_TICK_MS = 15000;
const PEEK_WHEEL_STEP = 40;

function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs, active]);
  return now;
}

function PresenterTimer() {
  const { t } = useTranslation();
  const timerRunning = usePresentationStore((state) => state.timerRunning);
  const timerStartedAt = usePresentationStore((state) => state.timerStartedAt);
  const timerElapsedMs = usePresentationStore((state) => state.timerElapsedMs);
  const toggleTimerRunning = usePresentationStore((state) => state.toggleTimerRunning);
  const resetTimer = usePresentationStore((state) => state.resetTimer);
  const ticking = useNow(TIMER_TICK_MS, timerRunning);
  const clock = useNow(CLOCK_TICK_MS);
  const elapsed = timerRunning && timerStartedAt !== null ? Math.max(0, ticking - timerStartedAt) : timerElapsedMs;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border bg-card p-3">
        <p className="text-xs text-muted-foreground">{t("presentation.presenter.elapsed")}</p>
        <p className="font-mono text-3xl tabular-nums" data-testid="presenter-elapsed">
          {formatElapsed(elapsed)}
        </p>
        <div className="mt-1 flex gap-1">
          <IconButton icon={timerRunning ? Pause : Play} label={t(timerRunning ? "presentation.timerPause" : "presentation.timerStart")} onClick={toggleTimerRunning} />
          <IconButton icon={RotateCcw} label={t("presentation.timerReset")} onClick={resetTimer} />
        </div>
      </div>
      <div className="rounded-lg border bg-card p-3">
        <p className="text-xs text-muted-foreground">{t("presentation.presenter.clock")}</p>
        <p className="font-mono text-3xl tabular-nums">{new Date(clock).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
    </div>
  );
}

export function PresenterConsole({ documentId, onExit, transport }: { documentId: string; onExit: () => void; transport?: PresenterTransport }) {
  const { t } = useTranslation();
  const session = usePresenterStore((state) => state.session);
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const onSignal = usePresenterConsole(documentId, transport);
  const blackout = usePresentationStore((state) => state.blackout);
  const toggleBlackout = usePresentationStore((state) => state.toggleBlackout);
  const tool = usePresentationStore((state) => state.tool);
  const hasTemporaryDrawings = usePresentationStore((state) => state.totalStrokeCount() > 0);
  const [styleOpen, setStyleOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const stageHostRef = useRef<HTMLDivElement>(null);
  const available = useBoxSize(stageHostRef);
  useOutsideDismiss(styleOpen, [barRef, styleRef], () => setStyleOpen(false));

  const aspect = session?.aspect ?? 16 / 9;
  const stage = fitBox(available, aspect);
  const currentPage = scrollState.currentPage;
  const totalPages = scrollState.totalPages;
  const nextIndex = currentPage < totalPages ? currentPage : null;
  const [peek, setPeek] = useState<{ from: number; index: number } | null>(null);
  const peekWheel = useRef(0);
  useEffect(() => setPeek(null), [currentPage]);
  const peekIndex = peek && peek.from === currentPage ? peek.index : null;
  const shownIndex = peekIndex ?? nextIndex;
  const peeking = peekIndex !== null && peekIndex !== nextIndex;
  const stepPeek = (delta: number) => {
    const target = Math.min(totalPages - 1, Math.max(0, (shownIndex ?? totalPages) + delta));
    setPeek({ from: currentPage, index: target });
  };
  const canPeekBack = (shownIndex ?? totalPages) > 0;
  const canPeekForward = shownIndex !== null && shownIndex < totalPages - 1;

  const fail = (error: unknown) => useToastStore.getState().push("error", describeError(t, toRpcError(error)));

  const runBusy = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    action()
      .catch(fail)
      .finally(() => setBusy(false));
  };

  return (
    <div role="region" aria-label={t("presentation.presenter.console")} className="flex min-h-0 flex-1 flex-col bg-background">
      <div ref={barRef} role="toolbar" aria-label={t("presentation.presenter.tools")} className="relative z-40 flex h-topbar flex-nowrap items-center gap-1 glass-flat border-b px-2">
        <IconButton icon={ChevronLeft} label={t("viewer.previousPage")} disabled={currentPage <= 1} onClick={() => scroll?.scrollToPreviousPage()} />
        <IconButton icon={ChevronRight} label={t("viewer.nextPage")} disabled={currentPage >= totalPages} onClick={() => scroll?.scrollToNextPage()} />
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <PresentationToolButtons
          pageIndex={currentPage - 1}
          onSelect={(next) => {
            if (!hasStyleOptions(next)) setStyleOpen(false);
          }}
        />
        <PresentationStyleTrigger open={styleOpen} onToggle={() => setStyleOpen((current) => !current)} />
        <PresentationInsertMenu />
        <TemporaryDrawingCleanup pageIndex={currentPage - 1} />
        {hasTemporaryDrawings ? <IconButton icon={FileDown} label={t("presentation.keep.finish")} onClick={() => void exitImmersiveSavingDrawings()} /> : null}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={Moon} label={t("presentation.blackoutBlack")} active={blackout === "black"} onClick={() => toggleBlackout("black")} />
        <IconButton icon={Sun} label={t("presentation.blackoutWhite")} active={blackout === "white"} onClick={() => toggleBlackout("white")} />
        <span className="flex-1" />
        <IconButton icon={ArrowLeftRight} label={t("presentation.presenter.swap")} disabled={!session?.external || busy} onClick={() => runBusy(swapScreens)} />
        <Button size="sm" variant="destructive" onClick={onExit}>
          {t("presentation.presenter.end")}
        </Button>
        {hasStyleOptions(tool) && styleOpen ? (
          <div ref={styleRef} className="glass select-pop origin-top pointer-events-auto absolute left-1/2 top-full mt-2 -translate-x-1/2 rounded-2xl p-3">
            <PresentationStyleControls />
          </div>
        ) : null}
      </div>
      {session && !session.external ? <p className="border-b bg-card px-4 py-2 text-sm text-muted-foreground">{t("presentation.presenter.rehearsal")}</p> : null}
      {session?.problem ? (
        <div role="alert" className="flex items-center gap-3 border-b bg-card px-4 py-2 text-sm">
          <span className="flex-1 text-destructive">{t(session.problem === "closed" ? "presentation.presenter.audienceClosed" : "presentation.presenter.audienceFailed")}</span>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => runBusy(() => reopenAudience(currentPage))}>
            {t("presentation.presenter.reopen")}
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <section aria-label={t("presentation.presenter.current")} ref={stageHostRef} className="flex min-w-0 flex-1 items-center justify-center">
          <div className="relative flex overflow-hidden rounded-lg border" style={{ width: stage.width, height: stage.height }}>
            <ImmersiveView documentId={documentId} onExit={onExit} variant="console" onSignal={onSignal} />
          </div>
        </section>
        <aside className="flex w-md shrink-0 flex-col gap-4 2xl:w-lg">
          <div className="flex items-center gap-1">
            <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium" data-testid="presenter-preview-heading">
              {peeking && shownIndex !== null ? t("presentation.presenter.peekHeading", { page: shownIndex + 1 }) : t("presentation.presenter.next")}
            </span>
            {peeking ? <IconButton icon={CornerUpLeft} label={t("presentation.presenter.peekReset")} onClick={() => setPeek(null)} /> : null}
            <IconButton icon={ChevronLeft} label={t("presentation.presenter.peekPrevious")} disabled={!canPeekBack} onClick={() => stepPeek(-1)} />
            <IconButton icon={ChevronRight} label={t("presentation.presenter.peekNext")} disabled={!canPeekForward} onClick={() => stepPeek(1)} />
            <span className="ms-2 shrink-0 whitespace-nowrap font-mono text-2xl tabular-nums" data-testid="presenter-counter">
              <span className="sr-only">{t("presentation.presenter.pageOf", { current: currentPage, total: totalPages })}</span>
              <span aria-hidden>
                {currentPage} / {totalPages}
              </span>
            </span>
          </div>
          <div
            className="flex min-h-40 flex-3 flex-col"
            onWheel={(event) => {
              peekWheel.current += event.deltaY;
              if (Math.abs(peekWheel.current) < PEEK_WHEEL_STEP) return;
              stepPeek(peekWheel.current > 0 ? 1 : -1);
              peekWheel.current = 0;
            }}
          >
            {shownIndex !== null ? (
              <NextPagePreview
                documentId={documentId}
                pageIndex={shownIndex}
                label={peeking ? t("presentation.presenter.peekGoTo", { page: shownIndex + 1 }) : t("presentation.presenter.nextPage", { page: shownIndex + 1 })}
                onSelect={() => (peeking ? scroll?.scrollToPage({ pageNumber: shownIndex + 1 }) : scroll?.scrollToNextPage())}
              />
            ) : (
              <p className="flex flex-1 items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">{t("presentation.presenter.endOfShow")}</p>
            )}
          </div>
          <PresenterTimer />
          <div className="flex min-h-40 flex-2 flex-col">{session ? <NotesEditor path={sessionPathOf(session.path)} pageIndex={currentPage - 1} pageCount={totalPages} /> : null}</div>
        </aside>
      </div>
    </div>
  );
}
