import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/preact";
import { DocumentContent, DocumentManagerPluginPackage, useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/preact";
import { InteractionManagerPluginPackage } from "@embedpdf/plugin-interaction-manager/preact";
import { RenderLayer, RenderPluginPackage } from "@embedpdf/plugin-render/preact";
import { Scroller, ScrollPluginPackage } from "@embedpdf/plugin-scroll/preact";
import { TilingLayer, TilingPluginPackage } from "@embedpdf/plugin-tiling/preact";
import { Viewport, ViewportPluginPackage } from "@embedpdf/plugin-viewport/preact";
import { ZoomMode, ZoomPluginPackage } from "@embedpdf/plugin-zoom/preact";
import { useEngine } from "./useEngine";

export type MountOptions = { src: string; mode: "range" | "full"; wasmUrl: string; mark: (name: string) => void };

export type Unmount = () => void;

const DOCUMENT_ID = "vive-document";

const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage, { maxDocuments: 1 }),
  createPluginRegistration(ViewportPluginPackage, { viewportGap: 12 }),
  createPluginRegistration(ScrollPluginPackage, { defaultPageGap: 10 }),
  createPluginRegistration(RenderPluginPackage, { withForms: true }),
  createPluginRegistration(InteractionManagerPluginPackage),
  createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
  createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 4, extraRings: 0 }),
];

function Pages() {
  return (
    <Viewport documentId={DOCUMENT_ID} style={{ height: "100%", backgroundColor: "#e9ebef" }}>
      <Scroller
        documentId={DOCUMENT_ID}
        renderPage={({ width, height, pageIndex }) => (
          <div data-page-index={pageIndex} style={{ width, height, position: "relative", backgroundColor: "#fff" }}>
            <RenderLayer documentId={DOCUMENT_ID} pageIndex={pageIndex} scale={1} />
            <TilingLayer documentId={DOCUMENT_ID} pageIndex={pageIndex} />
          </div>
        )}
      />
    </Viewport>
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

function Opener({ options }: { options: MountOptions }) {
  const { provides: documents } = useDocumentManagerCapability();
  useEffect(() => {
    if (!documents) return;
    options.mark("open-start");
    const file = { documentId: DOCUMENT_ID, name: options.src.split("/").pop() ?? "document.pdf" };
    const request =
      options.mode === "range"
        ? documents.openDocumentUrl({ url: options.src, mode: "range-request", ...file })
        : documents.openDocumentUrl({ url: options.src, ...file });
    request.toPromise().then(
      (response) => response.task.toPromise().then(() => options.mark("document-open"), () => options.mark("open-error")),
      () => options.mark("open-error"),
    );
  }, [documents, options]);
  return (
    <DocumentContent documentId={DOCUMENT_ID}>
      {({ isLoaded }) => (isLoaded ? <Pages /> : null)}
    </DocumentContent>
  );
}

function Viewer({ options }: { options: MountOptions }) {
  const { engine, error } = useEngine(options.wasmUrl);
  useEffect(() => {
    if (engine) options.mark("engine-ready");
  }, [engine, options]);
  useEffect(() => {
    if (error) options.mark("engine-error");
  }, [error, options]);
  if (error || !engine) return null;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <EmbedPDF engine={engine} plugins={plugins}>
        {({ pluginsReady }) => (pluginsReady ? <Opener options={options} /> : null)}
      </EmbedPDF>
      <FirstPageWatch mark={options.mark} />
    </div>
  );
}

export function mount(root: ShadowRoot, options: MountOptions): Unmount {
  const container = document.createElement("div");
  container.style.cssText = "position:absolute;inset:0";
  root.append(container);
  render(<Viewer options={options} />, container);
  return () => {
    render(null, container);
    container.remove();
  };
}

