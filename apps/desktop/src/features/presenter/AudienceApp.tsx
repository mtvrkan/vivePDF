import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { DocumentContent, useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { Button } from "@/components/shared/Button";
import { PageView } from "@/features/viewer/PageView";
import { PdfProvider } from "@/features/viewer/pdf/PdfProvider";
import { BlackoutLayer } from "@/features/viewer/presentation/BlackoutLayer";
import { PageDrawingCanvas } from "@/features/viewer/presentation/DrawingLayer";
import type { LiveSignal } from "@/features/viewer/presentation/liveSignal";
import { CurrentPageMask } from "@/features/viewer/presentation/CurrentPageMask";
import { usePageRects } from "@/features/viewer/presentation/usePageRects";
import { usePresentationFit } from "@/features/viewer/presentation/usePresentationFit";
import { preparedViewSource } from "@/features/viewer/viewableBytes";
import { cn } from "@/shared/lib/cn";
import * as logger from "@/shared/lib/logger";
import { basenameOf } from "@/shared/lib/paths";
import { openViewable, readOriginalSource } from "@/shared/session/viewSources";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { createAudienceLink, tauriTransport, type PresenterCommand } from "./presenterChannel";
import { commandForKey } from "./presenterCommands";
import { applyPatch, presentationFields, type SharedSlice, type StateMessage } from "./presenterSync";
import { RemotePointerLayer } from "./RemotePointerLayer";
import { SelectionMarksLayer } from "./SelectionMarksLayer";

const AUDIENCE_DOCUMENT_ID = "presenter-audience";

const READY_RETRY_MS = 1000;
const READY_ATTEMPTS = 10;
const WHEEL_STEP = 40;
const WHEEL_COOLDOWN_MS = 320;

type AudienceSession = { console: string; path: string; password: string | null; startPage: number };

type Loaded = { kind: "ready"; session: AudienceSession } | { kind: "error"; consoleLabel: string | null };

type DocumentManager = NonNullable<ReturnType<typeof useDocumentManagerCapability>["provides"]>;

type AudienceLink = Awaited<ReturnType<typeof createAudienceLink>>;

let loading: Promise<Loaded> | null = null;

function loadAudience(docManager: DocumentManager): Promise<Loaded> {
  loading ??= (async (): Promise<Loaded> => {
    let consoleLabel: string | null = null;
    try {
      const session = await invoke<AudienceSession | null>("presenter_session");
      if (!session) return { kind: "error", consoleLabel };
      consoleLabel = session.console;
      const password = session.password ?? undefined;
      const source = (await preparedViewSource(session.path, password)) ?? (await readOriginalSource(session.path));
      await openViewable(docManager, source, { name: basenameOf(session.path), documentId: AUDIENCE_DOCUMENT_ID, ...(password ? { password } : {}) });
      return { kind: "ready", session };
    } catch (error) {
      logger.error("presenter", logger.describeError(error));
      return { kind: "error", consoleLabel };
    }
  })();
  return loading;
}

function Preparing() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center bg-black">
      <p role="status" className="font-mono text-sm text-white/70">
        {t("presentation.presenter.preparing")}
      </p>
    </div>
  );
}

function AudienceStage({ session, slice, live, onCommand }: { session: AudienceSession; slice: SharedSlice | null; live: LiveSignal | null; onCommand: (command: PresenterCommand) => void }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const { settled } = usePresentationFit(AUDIENCE_DOCUMENT_ID, containerRef, session.startPage + 1);
  const rects = usePageRects(containerRef);
  const { provides: scroll, state: scrollState } = useScroll(AUDIENCE_DOCUMENT_ID);
  const wheel = useRef({ total: 0, last: 0 });
  const page = slice?.page ?? null;
  const selection = slice?.selection ?? null;

  useEffect(() => {
    if (!settled || page === null || !scroll || page === scrollState.currentPage) return;
    scroll.scrollToPage({ pageNumber: page, behavior: "instant" });
  }, [settled, page, scroll, scrollState.currentPage]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = wheel.current;
      state.total += event.deltaY;
      const now = performance.now();
      if (Math.abs(state.total) < WHEEL_STEP || now - state.last < WHEEL_COOLDOWN_MS) return;
      onCommand(state.total > 0 ? "next" : "previous");
      state.total = 0;
      state.last = now;
    };
    container.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => container.removeEventListener("wheel", onWheel, { capture: true });
  }, [onCommand]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={t("presentation.presenter.audienceRegion")}
      className="immersive-view relative h-full cursor-none overflow-hidden bg-black"
      onClick={() => onCommand("next")}
      onContextMenu={(event) => {
        event.preventDefault();
        onCommand("previous");
      }}
    >
      <div className={cn("h-full transition-opacity duration-150", settled ? "opacity-100" : "opacity-0")}>
        <PageView documentId={AUDIENCE_DOCUMENT_ID} readOnly decoratePage={(pageIndex) => <SelectionMarksLayer marks={selection} pageIndex={pageIndex} />} />
      </div>
      {settled ? <CurrentPageMask rects={rects} pageIndex={scrollState.currentPage - 1} tone="black" /> : null}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {rects.map((rect) => (
          <PageDrawingCanvas key={rect.pageIndex} rect={rect} />
        ))}
      </div>
      <div className="absolute inset-0 z-20" data-audience-capture="" />
      <RemotePointerLayer signal={live} rects={rects} />
      <BlackoutLayer contained hint={false} remote={live?.activeBoardStroke ?? null} />
    </div>
  );
}

function AudienceView() {
  const { t } = useTranslation();
  const { provides: docManager } = useDocumentManagerCapability();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [link, setLink] = useState<AudienceLink | null>(null);
  const [slice, setSlice] = useState<SharedSlice | null>(null);
  const [live, setLive] = useState<LiveSignal | null>(null);
  const consoleLabel = loaded?.kind === "ready" ? loaded.session.console : (loaded?.consoleLabel ?? null);

  useEffect(() => {
    if (!docManager) return;
    let cancelled = false;
    void loadAudience(docManager).then((result) => {
      if (!cancelled) setLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, [docManager]);

  useEffect(() => {
    if (!consoleLabel) return;
    let current: AudienceLink | null = null;
    let cancelled = false;
    const onState = (message: StateMessage) => setSlice((previous) => (message.kind === "full" ? message.slice : previous ? applyPatch(previous, message) : previous));
    void createAudienceLink({ transport: tauriTransport(), console: consoleLabel, onState, onLive: setLive }).then((created) => {
      if (cancelled) created.dispose();
      else {
        current = created;
        setLink(created);
      }
    });
    return () => {
      cancelled = true;
      current?.dispose();
      setLink(null);
    };
  }, [consoleLabel]);

  useEffect(() => {
    if (!slice) return;
    usePresentationStore.setState(presentationFields(slice));
  }, [slice]);

  const waitingForState = loaded?.kind === "ready" && link !== null && slice === null;
  useEffect(() => {
    if (!waitingForState || !link) return;
    let attempts = 0;
    void link.ready();
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts >= READY_ATTEMPTS) window.clearInterval(timer);
      void link.ready();
    }, READY_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [waitingForState, link]);

  useEffect(() => {
    if (loaded?.kind === "error" && link) void link.failed();
  }, [loaded, link]);

  const linkRef = useRef(link);
  linkRef.current = link;
  const onCommand = useCallback((command: PresenterCommand) => void linkRef.current?.command(command), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = commandForKey(event);
      if (!command) return;
      event.preventDefault();
      onCommand(command);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCommand]);

  if (!loaded) return <Preparing />;

  if (loaded.kind === "error") {
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <p className="max-w-md text-sm text-white/80">{t("presentation.presenter.audienceError")}</p>
        {link ? (
          <Button size="sm" variant="secondary" onClick={() => onCommand("end")}>
            {t("presentation.presenter.end")}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <DocumentContent documentId={AUDIENCE_DOCUMENT_ID}>
      {({ isLoaded }) => (isLoaded ? <AudienceStage session={loaded.session} slice={slice} live={live} onCommand={onCommand} /> : <Preparing />)}
    </DocumentContent>
  );
}

export function AudienceApp() {
  return (
    <main className="h-screen bg-black">
      <PdfProvider>
        <AudienceView />
      </PdfProvider>
    </main>
  );
}
