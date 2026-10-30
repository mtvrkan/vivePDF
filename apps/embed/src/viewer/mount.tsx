import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/preact";
import { DocumentContent, DocumentManagerPluginPackage, useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/preact";
import { InteractionManagerPluginPackage } from "@embedpdf/plugin-interaction-manager/preact";
import { RenderPluginPackage } from "@embedpdf/plugin-render/preact";
import { RotatePluginPackage } from "@embedpdf/plugin-rotate/preact";
import { ScrollPluginPackage } from "@embedpdf/plugin-scroll/preact";
import { SpreadPluginPackage } from "@embedpdf/plugin-spread/preact";
import { TilingPluginPackage } from "@embedpdf/plugin-tiling/preact";
import { ViewportPluginPackage } from "@embedpdf/plugin-viewport/preact";
import { ZoomMode, ZoomPluginPackage } from "@embedpdf/plugin-zoom/preact";
import { assetUrl, setAssetBase } from "../engine/assets";
import { createTranslator, type Lang } from "../i18n";
import viewerCss from "../styles/viewer.css?inline";
import { resolveTheme, type ThemeSetting } from "../styles/theme";
import { TranslateContext, useT } from "./i18nContext";
import { Pages } from "./Pages";
import { Pill } from "./Pill";
import { useEngine } from "./useEngine";

export type MountOptions = {
  src: string;
  mode: "range" | "full";
  assetBase: string;
  lang: Lang;
  theme: ThemeSetting;
  mark: (name: string) => void;
};

export type Unmount = () => void;

type OpenState = "loading" | "ready" | "error";

const DOCUMENT_ID = "vive-document";
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage, { maxDocuments: 1 }),
  createPluginRegistration(ViewportPluginPackage, { viewportGap: 12 }),
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
];

function Status({ kind, text }: { kind: "loading" | "error"; text: string }) {
  return (
    <div class="vp-status" data-kind={kind} role={kind === "error" ? "alert" : "status"}>
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

function Opener({ options, host }: { options: MountOptions; host: HTMLElement | null }) {
  const t = useT();
  const { provides: documents } = useDocumentManagerCapability();
  const [state, setState] = useState<OpenState>("loading");
  useEffect(() => {
    if (!documents) return;
    options.mark("open-start");
    const file = { documentId: DOCUMENT_ID, name: options.src.split("/").pop() ?? "document.pdf" };
    const request =
      options.mode === "range"
        ? documents.openDocumentUrl({ url: options.src, mode: "range-request", ...file })
        : documents.openDocumentUrl({ url: options.src, ...file });
    const fail = () => {
      setState("error");
      options.mark("open-error");
    };
    request.toPromise().then(
      (response) =>
        response.task.toPromise().then(() => {
          setState("ready");
          options.mark("document-open");
        }, fail),
      fail,
    );
  }, [documents, options]);
  if (state === "error") return <Status kind="error" text={t("openError")} />;
  return (
    <DocumentContent documentId={DOCUMENT_ID}>
      {({ isLoaded }) =>
        isLoaded ? (
          <>
            <Pages documentId={DOCUMENT_ID} />
            <Pill documentId={DOCUMENT_ID} host={host} />
          </>
        ) : (
          <Status kind="loading" text={t("loading")} />
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
  const { engine, error } = useEngine(assetUrl("pdfium.wasm"));
  const translate = useMemo(() => createTranslator(options.lang), [options.lang]);
  const prefersDark = usePrefersDark();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (engine) options.mark("engine-ready");
  }, [engine, options]);
  useEffect(() => {
    if (error) options.mark("engine-error");
  }, [error, options]);
  return (
    <TranslateContext.Provider value={translate}>
      <div ref={setHost} class="vp" data-theme={resolveTheme(options.theme, prefersDark)} role="region" aria-label={translate("viewer")}>
        {error ? <Status kind="error" text={translate("engineError")} /> : null}
        {!error && !engine ? <Status kind="loading" text={translate("loading")} /> : null}
        {engine ? (
          <EmbedPDF engine={engine} plugins={plugins}>
            {({ pluginsReady }) => (pluginsReady ? <Opener options={options} host={host} /> : null)}
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
