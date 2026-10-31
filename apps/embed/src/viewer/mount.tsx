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
import type { VivePdfMode } from "../api/types";
import { assetUrl, setAssetBase } from "../engine/assets";
import { createTranslator, type Lang } from "../i18n";
import viewerCss from "../styles/viewer.css?inline";
import { resolveTheme, type ThemeSetting } from "../styles/theme";
import type { ViewerCommand, ViewerEvent, ViewerSource } from "./bridge";
import { BusyToast } from "./BusyToast";
import { CommandQueue } from "./commandQueue";
import type { ViewerFeatures } from "./features";
import { downloadName } from "./fileName";
import { TranslateContext, useT } from "./i18nContext";
import { AnnotateContext, loadAnnotate, useAnnotateKit, type AnnotateKit, type AnnotateModule } from "./annotateContext";
import { Icon } from "./Icon";
import { useInlineScroll } from "./inlineScroll";
import { createLightbox } from "./lightbox";
import type { MenuItem } from "./MoreMenu";
import { OpenProblemView } from "./OpenProblemView";
import { engineFailure, errorCodeOf, problemFromDocument, problemFromEngine, problemFromStatus, type OpenProblem } from "./openError";
import { Pages } from "./Pages";
import { Pill } from "./Pill";
import { SearchBox, type SearchRequest } from "./SearchBox";
import { SidePanel, type PanelTab } from "./SidePanel";
import { useEngine } from "./useEngine";
import { useFileActions } from "./useFileActions";
import { useRefit } from "./useRefit";
import { useViewerApi, type StartPage } from "./useViewerApi";
import { useViewerKeys } from "./useViewerKeys";

export type MountOptions = {
  source: ViewerSource;
  mode: VivePdfMode;
  startPage: number;
  assetBase: string;
  lang: Lang;
  theme: ThemeSetting;
  fontBase: string | null;
  features: ViewerFeatures;
  fileName: string | null;
  mark: (name: string) => void;
  emit: (event: ViewerEvent) => void;
};

export type ViewerHandle = {
  update: (options: MountOptions) => void;
  command: (command: ViewerCommand) => void;
  show: () => void;
  close: () => void;
  unmount: () => void;
};

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

const basePlugins = (drawsAnnotations: boolean) => [
  createPluginRegistration(DocumentManagerPluginPackage, { maxDocuments: 1 }),
  createPluginRegistration(ViewportPluginPackage, { viewportGap: VIEWPORT_GAP }),
  createPluginRegistration(ScrollPluginPackage, { defaultPageGap: 10 }),
  createPluginRegistration(RenderPluginPackage, { withForms: true, withAnnotations: drawsAnnotations }),
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

function viewerPlugins(annotate: AnnotateModule | null) {
  return annotate ? [...basePlugins(false), ...annotate.annotatePlugins()] : basePlugins(true);
}

function useAnnotateModule(wanted: boolean): { module: AnnotateModule | null; waiting: boolean } {
  const [loaded, setLoaded] = useState<AnnotateModule | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!wanted || loaded || failed) return;
    let live = true;
    loadAnnotate().then(
      (module) => live && setLoaded(module),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [wanted, loaded, failed]);
  return { module: wanted ? loaded : null, waiting: wanted && !loaded && !failed };
}

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

type ViewerUiProps = {
  sourceUrl: string;
  fileName: string;
  mode: VivePdfMode;
  features: ViewerFeatures;
  host: HTMLElement | null;
  startPage: number;
  onPage: (page: number) => void;
  commands: CommandQueue<ViewerCommand>;
  emit: (event: ViewerEvent) => void;
};

function useStartPage(fitted: boolean, startPage: number, onPage: (page: number) => void): StartPage {
  const { state, provides: scroll } = useScroll(DOCUMENT_ID);
  const { provides: zoom } = useZoomCapability();
  const startedRef = useRef(false);
  const pendingRef = useRef<number | null>(startPage);
  const settleRef = useRef(() => {});
  useEffect(() => () => settleRef.current(), []);
  useEffect(() => {
    if (startedRef.current || !fitted || !scroll || !zoom || state.totalPages < startPage) return;
    startedRef.current = true;
    if (startPage <= 1) {
      pendingRef.current = null;
      return;
    }
    const toStart = () => scroll.scrollToPage({ pageNumber: startPage, behavior: "instant" });
    toStart();
    let frame = 0;
    const stop = zoom.forDocument(DOCUMENT_ID).onZoomChange((change) => {
      if (change.oldZoom !== change.newZoom) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(toStart);
    });
    const finish = () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      stop();
      pendingRef.current = null;
    };
    const timer = window.setTimeout(finish, START_PAGE_SETTLE_MS);
    settleRef.current = finish;
  }, [fitted, scroll, zoom, startPage, state.totalPages]);
  useEffect(() => {
    if (startedRef.current) onPage(state.currentPage);
  }, [state.currentPage, onPage]);
  const settle = useCallback(() => {
    startedRef.current = true;
    pendingRef.current = null;
    settleRef.current();
  }, []);
  const pending = useCallback(() => pendingRef.current, []);
  return useMemo(() => ({ settle, pending }), [settle, pending]);
}

function ViewerUi({ sourceUrl, fileName, mode, features, host, startPage, onPage, commands, emit }: ViewerUiProps) {
  const t = useT();
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("pages");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const panelButtonRef = useRef<HTMLButtonElement>(null);
  const fitted = useRefit(DOCUMENT_ID, host, VIEWPORT_GAP);
  const searchShown = features.toolbar && features.search;
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
  const searchFor = useCallback((query: string) => {
    setSearchRequest((current) => ({ query, id: (current?.id ?? 0) + 1 }));
    setSearchOpen(true);
  }, []);
  const annotateKit = useAnnotateKit();
  const drawing = annotateKit ? annotateKit.module.useAnnotateSession(DOCUMENT_ID) : null;
  const files = useFileActions(DOCUMENT_ID, sourceUrl, fileName, drawing?.edited ? drawing.save : null);
  const print = features.print ? files.print : null;
  const download = features.download ? files.download : null;
  const start = useStartPage(fitted, startPage, onPage);
  useViewerApi(DOCUMENT_ID, fitted, commands, emit, { search: searchShown ? searchFor : null, print, download, start });
  useViewerKeys(DOCUMENT_ID, host, searchShown ? openSearch : null, { print, download });
  useInlineScroll(fitted ? host : null, mode === "inline");
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
          {searchShown ? <SearchBox documentId={DOCUMENT_ID} open={searchOpen} onOpenChange={setSearchOpen} request={searchRequest} /> : null}
          <Pill documentId={DOCUMENT_ID} host={host} panelOpen={panelOpen} onTogglePanel={() => (panelOpen ? closePanel() : setPanelOpen(true))} panelButtonRef={panelButtonRef} fileItems={fileItems} branding={features.branding} drawing={drawing ? { open: drawing.open, toggle: () => drawing.setOpen(!drawing.open) } : null} />
          {drawing && annotateKit ? <annotateKit.module.AnnotateBar session={drawing} lang={annotateKit.lang} /> : null}
        </>
      ) : null}
      {files.task ? <BusyToast task={files.task} onCancel={files.cancel} /> : null}
    </>
  );
}

type OpenerProps = { options: MountOptions; host: HTMLElement | null; startPage: number; onPage: (page: number) => void; commands: CommandQueue<ViewerCommand> };

function Opener({ options, host, startPage, onPage, commands }: OpenerProps) {
  const t = useT();
  const { provides: documents } = useDocumentManagerCapability();
  const [state, setState] = useState<OpenState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const activeRef = useRef(true);
  const { source, mark, emit } = options;
  const fileName = downloadName(source.url, options.fileName);
  const nameRef = useRef(fileName);
  nameRef.current = fileName;
  const problem = state.kind === "problem" ? state.problem : null;

  useEffect(() => {
    if (problem) emit({ type: "error", detail: { code: errorCodeOf(problem) } });
  }, [problem, emit]);

  useEffect(() => {
    if (!documents) return;
    return () => {
      documents.closeDocument(DOCUMENT_ID);
    };
  }, [documents]);

  const settle = useCallback(
    (request: OpenTask, passwordProvided: boolean) => {
      const fail = (reason: unknown) => {
        if (!activeRef.current) return;
        setState({ kind: "problem", problem: problemFromEngine(engineFailure(reason), passwordProvided), busy: false });
        mark("open-error");
      };
      request.toPromise().then(
        (response) =>
          response.task.toPromise().then((opened) => {
            if (!activeRef.current) return;
            const empty = problemFromDocument(opened.pageCount);
            if (empty) {
              setState({ kind: "problem", problem: empty, busy: false });
              mark("open-error");
              return;
            }
            setState({ kind: "ready" });
            mark("document-open");
            emit({ type: "ready", detail: { pageCount: opened.pageCount } });
          }, fail),
        fail,
      );
    },
    [mark, emit],
  );

  useEffect(() => {
    if (!documents) return;
    activeRef.current = true;
    const controller = new AbortController();
    const name = nameRef.current;
    const fail = (failure: OpenProblem) => {
      if (!activeRef.current) return;
      setState({ kind: "problem", problem: failure, busy: false });
      mark("open-error");
    };
    const openBuffer = (buffer: ArrayBuffer) => {
      if (activeRef.current) settle(documents.openDocumentBuffer({ buffer, name, documentId: DOCUMENT_ID }), false);
    };
    mark("open-start");
    if (source.kind === "data") {
      source.data.arrayBuffer().then(openBuffer, () => fail("unknown"));
    } else if (source.load === "range") {
      settle(documents.openDocumentUrl({ url: source.url, mode: "range-request", documentId: DOCUMENT_ID, name }), false);
    } else {
      fetch(source.url, { signal: controller.signal })
        .then((response) => (response.ok ? response.arrayBuffer().then(openBuffer) : fail(problemFromStatus(response.status))))
        .catch(() => fail("network"));
    }
    return () => {
      activeRef.current = false;
      controller.abort();
    };
  }, [documents, source, attempt, settle, mark]);

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
    return <OpenProblemView problem={state.problem} sourceUrl={source.url} offerDownload={options.features.download} busy={state.busy} onRetry={() => reopen()} onPassword={(password) => reopen(password)} />;
  return (
    <DocumentContent documentId={DOCUMENT_ID}>
      {({ isLoaded }) =>
        isLoaded ? (
          <ViewerUi sourceUrl={source.url} fileName={fileName} mode={options.mode} features={options.features} host={host} startPage={startPage} onPage={onPage} commands={commands} emit={emit} />
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

type ViewerProps = { options: MountOptions; commands: CommandQueue<ViewerCommand>; onDismiss: () => void };

function Viewer({ options, commands, onDismiss }: ViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const restartsRef = useRef(0);
  const pageRef = useRef(options.startPage);
  const sourceRef = useRef(options.source);
  const generationRef = useRef(0);
  if (sourceRef.current !== options.source) {
    sourceRef.current = options.source;
    generationRef.current += 1;
    pageRef.current = options.startPage;
  }
  const { mark, emit } = options;
  const { engine, failure } = useEngine(assetUrl("pdfium.wasm"), options.fontBase, attempt);
  const translate = useMemo(() => createTranslator(options.lang), [options.lang]);
  const annotate = useAnnotateModule(options.features.annotate);
  const plugins = useMemo(() => viewerPlugins(annotate.module), [annotate.module]);
  const annotateKit = useMemo<AnnotateKit | null>(() => (annotate.module ? { module: annotate.module, lang: options.lang } : null), [annotate.module, options.lang]);
  const prefersDark = usePrefersDark();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const restarting = failure === "crash" && restartsRef.current < MAX_RESTARTS;
  useEffect(() => {
    if (engine) mark("engine-ready");
  }, [engine, mark]);
  useEffect(() => {
    if (!failure) return;
    mark(failure === "crash" ? "engine-crash" : "engine-error");
    if (failure === "crash" && restartsRef.current < MAX_RESTARTS) {
      restartsRef.current += 1;
      setAttempt((value) => value + 1);
    } else emit({ type: "error", detail: { code: "engine" } });
  }, [failure, mark, emit]);
  const onPage = useCallback((page: number) => {
    pageRef.current = page;
  }, []);
  return (
    <TranslateContext.Provider value={translate}>
      <div ref={setHost} class="vp" data-theme={resolveTheme(options.theme, prefersDark)} data-mode={options.mode} role="region" aria-label={translate("viewer")}>
        {failure && !restarting ? (
          <OpenProblemView problem="engine" sourceUrl={options.source.url} offerDownload={options.features.download} busy={false} onRetry={() => setAttempt((value) => value + 1)} onPassword={() => {}} />
        ) : null}
        {!failure && (!engine || annotate.waiting) ? <Loading text={translate("loading")} /> : null}
        {engine && !failure && !annotate.waiting ? (
          <AnnotateContext.Provider value={annotateKit}>
            <EmbedPDF key={`${attempt}-${generationRef.current}-${annotateKit ? "draw" : "read"}`} engine={engine} plugins={plugins}>
              {({ pluginsReady }) => (pluginsReady ? <Opener options={options} host={host} startPage={pageRef.current} onPage={onPage} commands={commands} /> : null)}
            </EmbedPDF>
          </AnnotateContext.Provider>
        ) : null}
        {options.mode === "lightbox" ? (
          <button class="vp-btn vp-glass vp-close" type="button" aria-label={translate("close")} title={translate("close")} onClick={onDismiss}>
            <Icon name="close" />
          </button>
        ) : null}
        <FirstPageWatch mark={mark} />
      </div>
    </TranslateContext.Provider>
  );
}

export function mount(root: ShadowRoot, options: MountOptions): ViewerHandle {
  setAssetBase(options.assetBase);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(viewerCss);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  const container = document.createElement("div");
  container.className = "vp-frame";
  root.append(container);
  const commands = new CommandQueue<ViewerCommand>();
  let current = options;
  const lightbox = createLightbox(root, container, () => current.emit({ type: "close", detail: null }));
  const draw = (next: MountOptions) => {
    current = next;
    container.dataset.mode = next.mode;
    lightbox.place(next.mode === "lightbox", createTranslator(next.lang)("viewer"));
    render(<Viewer options={next} commands={commands} onDismiss={lightbox.close} />, container);
  };
  draw(options);
  return {
    update: draw,
    command: (command) => commands.push(command),
    show: lightbox.show,
    close: lightbox.close,
    unmount: () => {
      render(null, container);
      container.remove();
      lightbox.dispose();
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((entry) => entry !== sheet);
    },
  };
}
