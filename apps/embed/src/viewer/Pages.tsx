import { PagePointerProvider } from "@embedpdf/plugin-interaction-manager/preact";
import { RenderLayer } from "@embedpdf/plugin-render/preact";
import { Rotate } from "@embedpdf/plugin-rotate/preact";
import { Scroller } from "@embedpdf/plugin-scroll/preact";
import { SearchLayer } from "@embedpdf/plugin-search/preact";
import { TilingLayer } from "@embedpdf/plugin-tiling/preact";
import { Viewport } from "@embedpdf/plugin-viewport/preact";
import { ZoomGestureWrapper } from "@embedpdf/plugin-zoom/preact";

export function Pages({ documentId }: { documentId: string }) {
  return (
    <div class="vp-stage">
      <Viewport documentId={documentId} class="vp-viewport">
        <ZoomGestureWrapper documentId={documentId} style={{ display: "block", width: "100%", minWidth: "fit-content" }}>
          <Scroller
            documentId={documentId}
            renderPage={({ width, height, pageIndex }) => (
              <Rotate documentId={documentId} pageIndex={pageIndex} style={{ width, height }}>
                <PagePointerProvider documentId={documentId} pageIndex={pageIndex} class="vp-page" data-page-index={pageIndex} style={{ width, height }}>
                  <RenderLayer documentId={documentId} pageIndex={pageIndex} scale={1} role="presentation" />
                  <TilingLayer documentId={documentId} pageIndex={pageIndex} role="presentation" />
                  <SearchLayer documentId={documentId} pageIndex={pageIndex} highlightColor="var(--vp-hit)" activeHighlightColor="var(--vp-hit-active)" />
                </PagePointerProvider>
              </Rotate>
            )}
          />
        </ZoomGestureWrapper>
      </Viewport>
    </div>
  );
}
