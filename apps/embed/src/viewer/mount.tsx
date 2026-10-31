import { render } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/preact";
import { DocumentContent, DocumentManagerPluginPackage, useDocumentManagerCapability, type DocumentManagerCapability } from "@embedpdf/plugin-document-manager/preact";
import { InteractionManagerPluginPackage } from "@embedpdf/plugin-interaction-manager/preact";
import { RenderPluginPackage } from "@embedpdf/plugin-render/preact";
import { RotatePluginPackage } from "@embedpdf/plugin-rotate/preact";
import { ScrollPluginPackage, useScroll } from "@embedpdf/plugin-scroll/preact";
import { SearchPluginPackage } from "@embedpdf/plugin-search/preact";
import { SelectionPluginPackage } from "@embedpdf/plugin-selection/preact";
import { SpreadPluginPackage } from "@embedpdf/plugin-spread/preact";
import { ThumbnailPluginPackage } from "@embedpdf/plugin-thumbnail/preact";
import { TilingPluginPackage } from "@embedpdf/plugin-tiling/preact";
import { ViewportPluginPackage } from "@embedpdf/plugin-viewport/preact";
import { ZoomMode, ZoomPluginPackage, useZoomCapability } from "@embedpdf/plugin-zoom/preact";
import { assetUrl, setAssetBase } from "../engine/assets";
import { createTranslator, type Lang } from "../i18n";
import viewerCss from "../styles/viewer.css?inline";
import { resolveTheme, type ThemeSetting } from "../styles/theme";
import { BusyToast } from "./BusyToast";
import type { ViewerFeatures } from "./features";
import { downloadName } from "./fileName";
import { TranslateContext, useT } from "./i18nContext";
import type { MenuItem } from "./MoreMenu";
import { OpenProblemView } from "./OpenProblemView";
import { engineFailure, problemFromDocument, problemFromEngine, problemFromStatus, type OpenProblem } from "./openError";
import { Pages } from "./Pages";
import { Pill } from "./Pill";
import { SearchBox } from "./SearchBox";
import { SidePanel, type PanelTab } from "./SidePanel";
import { useEngine } from "./useEngine";
import { useFileActions } from "./useFileActions";
import { useRefit } from "./useRefit";
import { useViewerKeys } from "./useViewerKeys";

export type MountOptions = {
  src: string;
  mode: "range" | "full";
  assetBase: string;
  lang: Lang;
  theme: ThemeSetting;
  fontBase: string | null;
  features: ViewerFeatures;
  fileName: string | null;
  mark: (name: string) => void;
};

export type Unmount = () => void;

type OpenState = { kind: "loading" } | { kind: "ready" } | { kind: "problem"; problem: OpenProblem; busy: boolean };
type OpenTask = ReturnType<DocumentManagerCapability["openDocumentUrl"]>;

const DOCUMENT_ID = "vive-document";
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const THUMB_WIDTH = 120;
const NARROW_PX = 560;
const MAX_RESTARTS = 1;
const START_PAGE_SETTLE_MS = 1000;
const VIEWPORT_GAP = 12;

const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage, { maxDocuments: 1 }),
  createPluginRegistration(ViewportPluginPackage, { viewportGap: VIEWPORT_GAP }),
  createPluginRegistration(ScrollPluginPackage, { defaultPageGap: 10 }),
  createPluginRegistration(RenderPluginPackage, { withForms: true }),
  createPluginRegistration(InteractionManagerPluginPackage),
  createPluginRegistration(ZoomPluginPackage, {
    defaultZoomLevel: ZoomMode.FitWidth,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomRanges: [
      { min: MIN_ZOOM, max: 1, step: 0.1 },
      { min: 1, max: 2, step: 0.25 },
      { min: 2, max: 4, step: 0.5 },
      { min: 4, max: MAX_ZOOM, step: 1 },
    ],
  }),
  createPluginRegistration(RotatePluginPackage),
  createPluginRegistration(SpreadPluginPackage),
  createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 4, extraRings: 0 }),
  createPluginRegistration(SearchPluginPackage),
  createPluginRegistration(SelectionPluginPackage),
  createPluginRegistration(ThumbnailPluginPackage, { width: THUMB_WIDTH, gap: 14, labelHeight: 22, paddingY: 12, autoScroll: true, scrollBehavior: "auto" }),
];

function Loading({ text }: { text: string }) {
  return (
    <div class="vp-status" role="status">
      {text}
    </div>
  );
}

function FirstPageWatch({ mark }: { mark: MountOptions["mark"] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    let done = false;
    const check = () => {
      const image = host.querySelector<HTMLImageElement>('[data-page-index="0"] img');
      if (done || !image) return;
      const report = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        mark("first-page");
      };
      if (image.complete && image.naturalWidth > 0) report();
      else image.addEventListener("load", report, { once: true });
    };
    const observer = new MutationObserver(check);
    observer.observe(host, { childList: true, subtree: true });
    return () => {
      done = true;
      observer.disconnect();
    };
  }, [mark]);
  return <div ref={ref} hidden />;
}

type ViewerUiProps = { sourceUrl: string; fileName: string; features: ViewerFeatures; host: HTMLElement | null; startPage: number; onPage: (page: number) => void };

function useStartPage(fitted: boolean, startPage: number, onPage: (page: number) => void): void {
  const { state, provides: scroll } = useScroll(DOCUMENT_ID);
  const { provides: zoom } = useZoomCapability();
  const startedRef = useRef(false);
  const settleRef = useRef(() => {});
  useEffect(() => () => settleRef.current(), []);
  useEffect(() => {
    if (startedRef.current || !fitted || !scroll || !zoom || state.totalPages < startPage) return;
    startedRef.current = true;
    if (startPage <= 1) return;
    const toStart = () => scroll.scrollToPage({ pageNumber: startPage, behavior: "instant" });
    toStart();
    let frame = 0;
    const stop = zoom.forDocument(DOCUMENT_ID).onZoomChange((change) => {
      if (change.oldZoom !== change.newZoom) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(toStart);
    });
    const timer = window.setTimeout(stop, START_PAGE_SETTLE_MS);
    settleRef.current = () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      stop();
    };
  }, [fitted, scroll, zoom, startPage, state.totalPages]);
  useEffect(() => {
    if (startedRef.current) onPage(state.currentPage);
  }, [state.currentPage, onPage]);
}

function ViewerUi({ sourceUrl, fileName, features, host, startPage, onPage }: ViewerUiProps) {
  const t = useT();
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("pages");
  const [searchOpen, setSearchOpen] = useState(false);
  const panelButtonRef = useRef<HTMLButtonElement>(null);
  const fitted = useRefit(DOCUMENT_ID, host, VIEWPORT_GAP);
  useStartPage(fitted, startPage, onPage);
  const closePanel = () => {
    setPanelOpen(false);
    panelButtonRef.current?.focus();
  };
  useEffect(() => {
    host?.setAttribute("data-panel", panelOpen ? "open" : "closed");
  }, [host, panelOpen]);
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    host?.querySelector<HTMLInputElement>(".vp-search input")?.focus();
  }, [host]);
  const files = useFileActions(DOCUMENT_ID, sourceUrl, fileName);
  const print = features.print ? files.print : null;
  const download = features.download ? files.download : null;
  useViewerKeys(DOCUMENT_ID, host, openSearch, { print, download });
  const fileItems: MenuItem[] = [];
  if (print) fileItems.push({ kind: "action", id: "print", label: t("print"), icon: "print", onSelect: print });
  if (download) fileItems.push({ kind: "action", id: "download", label: t("download"), icon: "download", onSelect: download });
  return (
    <>
      <Pages documentId={DOCUMENT_ID} sourceUrl={sourceUrl} />
      {panelOpen ? (
        <SidePanel
          documentId={DOCUMENT_ID}
          sourceUrl={sourceUrl}
          tab={panelTab}
          onTabChange={setPanelTab}
          onClose={closePanel}
          onPick={() => {
            if (host && host.clientWidth < NARROW_PX) closePanel();
          }}
        />
      ) : null}
      {features.toolbar ? (
        <>
          <SearchBox documentId={DOCUMENT_ID} open={searchOpen} onOpenChange={setSearchOpen} />
          <Pill documentId={DOCUMENT_ID} host={host} panelOpen={panelOpen} onTogglePanel={() => (panelOpen ? closePanel() : setPanelOpen(true))} panelButtonRef={panelButtonRef} fileItems={fileItems} />
        </>
      ) : null}
      {files.task ? <BusyToast task={files.task} onCancel={files.cancel} /> : null}
    </>
  );
}

function Opener({ options, host, startPage, onPage }: { options: MountOptions; host: HTMLElement | null; startPage: number; onPage: (page: number) => void }) {
  const t = useT();
  const { provides: documents } = useDocumentManagerCapability();
  const [state, setState] = useState<OpenState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const activeRef = useRef(true);

  const settle = useCallback(
    (request: OpenTask, passwordProvided: boolean) => {
      const fail = (reason: unknown) => {
        if (!activeRef.current) return;
        setState({ kind: "problem", problem: problemFromEngine(engineFailure(reason), passwordProvided), busy: false });
        options.mark("open-error");
      };
      request.toPromise().then(
        (response) =>
          response.task.toPromise().then((opened) => {
            if (!activeRef.current) return;
            const problem = problemFromDocument(opened.pageCount);
            if (problem) {
              setState({ kind: "problem", problem, busy: false });
              options.mark("open-error");
              return;
            }
            setState({ kind: "ready" });
            options.mark("document-open");
          }, fail),
        fail,
      );
    },
    [options],
  );

  useEffect(() => {
    if (!documents) return;
    activeRef.current = true;
    const controller = new AbortController();
    const name = downloadName(options.src, options.fileName);
    options.mark("open-start");
    if (options.mode === "range") {
      settle(documents.openDocumentUrl({ url: options.src, mode: "range-request", documentId: DOCUMENT_ID, name }), false);
    } else {
      const fail = (problem: OpenProblem) => {
        if (!activeRef.current) return;
        setState({ kind: "problem", problem, busy: false });
        options.mark("open-error");
      };
      fetch(options.src, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) return fail(problemFromStatus(response.status));
          return response.arrayBuffer().then((buffer) => {
            if (activeRef.current) settle(documents.openDocumentBuffer({ buffer, name, documentId: DOCUMENT_ID }), false);
          });
        })
        .catch(() => fail("network"));
    }
    return () => {
      activeRef.current = false;
      controller.abort();
    };
  }, [documents, options, attempt, settle]);

  const reopen = (password?: string) => {
    if (!documents) return;
    if (!documents.getDocumentState(DOCUMENT_ID)) {
      setState({ kind: "loading" });
      setAttempt((value) => value + 1);
      return;
    }
    setState((current) => (current.kind === "problem" && password !== undefined ? { ...current, busy: true } : { kind: "loading" }));
    settle(documents.retryDocument(DOCUMENT_ID, password === undefined ? undefined : { password }), password !== undefined);
  };

  if (state.kind === "problem")
    return <OpenProblemView problem={state.problem} sourceUrl={options.src} offerDownload={options.features.download} busy={state.busy} onRetry={() => reopen()} onPassword={(password) => reopen(password)} />;
  return (
    <DocumentContent documentId={DOCUMENT_ID}>
      {({ isLoaded }) =>
        isLoaded ? (
          <ViewerUi sourceUrl={options.src} fileName={downloadName(options.src, options.fileName)} features={options.features} host={host} startPage={startPage} onPage={onPage} />
        ) : (
          <Loading text={t("loading")} />
        )
      }
    </DocumentContent>
  );
}

function usePrefersDark(): boolean {
  const query = useMemo(() => window.matchMedia("(prefers-color-scheme: dark)"), []);
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const update = () => setDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [query]);
  return dark;
}

function Viewer({ options }: { options: MountOptions }) {
  const [attempt, setAttempt] = useState(0);
  const restartsRef = useRef(0);
  const pageRef = useRef(1);
  const { engine, failure } = useEngine(assetUrl("pdfium.wasm"), options.fontBase, attempt);
  const translate = useMemo(() => createTranslator(options.lang), [options.lang]);
  const prefersDark = usePrefersDark();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const restarting = failure === "crash" && restartsRef.current < MAX_RESTARTS;
  useEffect(() => {
    if (engine) options.mark("engine-ready");
  }, [engine, options]);
  useEffect(() => {
    if (!failure) return;
    options.mark(failure === "crash" ? "engine-crash" : "engine-error");
    if (failure === "crash" && restartsRef.current < MAX_RESTARTS) {
      restartsRef.current += 1;
      setAttempt((value) => value + 1);
    }
  }, [failure, options]);
  const onPage = useCallback((page: number) => {
    pageRef.current = page;
  }, []);
  return (
    <TranslateContext.Provider value={translate}>
      <div ref={setHost} class="vp" data-theme={resolveTheme(options.theme, prefersDark)} role="region" aria-label={translate("viewer")}>
        {failure && !restarting ? (
          <OpenProblemView problem="engine" sourceUrl={options.src} offerDownload={options.features.download} busy={false} onRetry={() => setAttempt((value) => value + 1)} onPassword={() => {}} />
        ) : null}
        {!failure && !engine ? <Loading text={translate("loading")} /> : null}
        {engine && !failure ? (
          <EmbedPDF key={attempt} engine={engine} plugins={plugins}>
            {({ pluginsReady }) => (pluginsReady ? <Opener options={options} host={host} startPage={pageRef.current} onPage={onPage} /> : null)}
          </EmbedPDF>
        ) : null}
        <FirstPageWatch mark={options.mark} />
      </div>
    </TranslateContext.Provider>
  );
}

export function mount(root: ShadowRoot, options: MountOptions): Unmount {
  setAssetBase(options.assetBase);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(viewerCss);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  const container = document.createElement("div");
  root.append(container);
  render(<Viewer options={options} />, container);
  return () => {
    render(null, container);
    container.remove();
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((entry) => entry !== sheet);
  };
}
