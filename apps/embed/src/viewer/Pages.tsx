import { GlobalPointerProvider, PagePointerProvider } from "@embedpdf/plugin-interaction-manager/preact";
import { RenderLayer } from "@embedpdf/plugin-render/preact";
import { Rotate } from "@embedpdf/plugin-rotate/preact";
import { Scroller, useScroll } from "@embedpdf/plugin-scroll/preact";
import { SearchLayer } from "@embedpdf/plugin-search/preact";
import { SelectionLayer } from "@embedpdf/plugin-selection/preact";
import { TilingLayer } from "@embedpdf/plugin-tiling/preact";
import { Viewport } from "@embedpdf/plugin-viewport/preact";
import { ZoomGestureWrapper } from "@embedpdf/plugin-zoom/preact";
import { useAnnotateKit } from "./annotateContext";
import { useT } from "./i18nContext";
import { LinkLayer } from "./LinkLayer";

export function Pages({ documentId, sourceUrl }: { documentId: string; sourceUrl: string }) {
  const t = useT();
  const { state } = useScroll(documentId);
  const annotate = useAnnotateKit();
  return (
    <GlobalPointerProvider documentId={documentId} class="vp-stage">
      <Viewport documentId={documentId} class="vp-viewport" tabIndex={0} role="region" aria-label={t("pages")}>
        <ZoomGestureWrapper documentId={documentId} style={{ display: "block", width: "100%", minWidth: "fit-content" }}>
          <Scroller
            documentId={documentId}
            renderPage={({ width, height, pageIndex }) => (
              <Rotate documentId={documentId} pageIndex={pageIndex} style={{ width, height }}>
                <PagePointerProvider
                  documentId={documentId}
                  pageIndex={pageIndex}
                  class="vp-page"
                  data-page-index={pageIndex}
                  role="group"
                  aria-label={t("pageOfTotal", { page: pageIndex + 1, total: state.totalPages })}
                  style={{ width, height }}
                  onDragStart={(event) => event.preventDefault()}
                >
                  <RenderLayer documentId={documentId} pageIndex={pageIndex} scale={1} dpr={1} role="presentation" />
                  <TilingLayer documentId={documentId} pageIndex={pageIndex} role="presentation" />
                  <SearchLayer documentId={documentId} pageIndex={pageIndex} highlightColor="var(--vp-hit)" activeHighlightColor="var(--vp-hit-active)" />
                  <SelectionLayer documentId={documentId} pageIndex={pageIndex} background="var(--vp-selection)" />
                  {annotate ? <annotate.module.AnnotatePageLayer documentId={documentId} pageIndex={pageIndex} lang={annotate.lang} /> : null}
                  <LinkLayer documentId={documentId} pageIndex={pageIndex} sourceUrl={sourceUrl} />
                </PagePointerProvider>
              </Rotate>
            )}
          />
        </ZoomGestureWrapper>
      </Viewport>
    </GlobalPointerProvider>
  );
}
