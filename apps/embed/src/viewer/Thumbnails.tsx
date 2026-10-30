import { useScroll } from "@embedpdf/plugin-scroll/preact";
import { ThumbImg, ThumbnailsPane, type ThumbMeta } from "@embedpdf/plugin-thumbnail/preact";
import { useT } from "./i18nContext";

export function Thumbnails({ documentId, onPick }: { documentId: string; onPick: () => void }) {
  const t = useT();
  const { state, provides: scroll } = useScroll(documentId);
  return (
    <ThumbnailsPane documentId={documentId} class="vp-thumbs">
      {(meta: ThumbMeta) => {
        const current = meta.pageIndex + 1 === state.currentPage;
        return (
          <button
            key={meta.pageIndex}
            type="button"
            class="vp-thumb"
            aria-current={current ? "page" : undefined}
            aria-label={t("pageLabel", { page: meta.pageIndex + 1 })}
            style={{ top: meta.top, height: meta.wrapperHeight }}
            onClick={() => {
              scroll?.scrollToPage({ pageNumber: meta.pageIndex + 1, behavior: "instant" });
              onPick();
            }}
          >
            <span class="vp-thumb-frame" style={{ width: meta.width, height: meta.height }}>
              <ThumbImg documentId={documentId} meta={meta} aria-hidden="true" style={{ width: "100%", height: "100%" }} />
            </span>
            <span class="vp-thumb-label" aria-hidden="true">
              {meta.pageIndex + 1}
            </span>
          </button>
        );
      }}
    </ThumbnailsPane>
  );
}
