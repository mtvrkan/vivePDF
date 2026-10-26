import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/ErrorState";
import { describeError } from "@/shared/lib/errorMessage";
import { studioPreviewDocumentPage } from "@/shared/rpc/operations";
import type { StudioDocumentPreview } from "@/types/studio";
import type { DocumentLayout } from "./useDocumentLayout";
const PAGE_PIXELS = 1100;

function PreviewPage({ preview, index, label }: { preview: StudioDocumentPreview; index: number; label: string }) {
  const host = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<{ token: string; src: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)), { rootMargin: "400px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || image?.token === preview.token) return;
    let live = true;
    studioPreviewDocumentPage({ token: preview.token, page: index, width: PAGE_PIXELS })
      .then((result) => {
        if (live) {
          setImage({ token: preview.token, src: `data:image/png;base64,${result.image}` });
          setFailed(false);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [visible, preview.token, index, image?.token]);

  return (
    <li ref={host} className="relative overflow-hidden rounded-sm border border-border bg-white shadow-sm" style={{ aspectRatio: `${preview.width} / ${preview.height}` }} data-preview-page={index + 1}>
      {image ? (
        <img src={image.src} alt={label} className="block h-full w-full" draggable={false} />
      ) : (
        <div className={failed ? "h-full w-full bg-muted" : "h-full w-full animate-pulse bg-muted"} aria-hidden />
      )}
    </li>
  );
}

export function DocumentPreview({ layout }: { layout: DocumentLayout }) {
  const { t } = useTranslation();
  const { preview, error, busy, refresh } = layout;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("studio.doc.preview.title")} data-testid="document-preview">
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        <span data-testid="document-preview-status">{busy ? t("studio.doc.preview.updating") : preview ? t("studio.doc.preview.pages", { count: preview.pageCount }) : ""}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {error && !busy ? (
          <ErrorState title={t("studio.doc.preview.failed")} message={describeError(t, error)} onRetry={() => void refresh()} />
        ) : preview ? (
          <ol className="mx-auto max-w-2xl space-y-4" aria-label={t("studio.doc.preview.title")}>
            {Array.from({ length: preview.pageCount }, (_, index) => (
              <PreviewPage key={index} preview={preview} index={index} label={t("studio.doc.preview.page", { page: index + 1 })} />
            ))}
          </ol>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4" aria-busy>
            <div className="animate-pulse rounded-sm bg-muted" style={{ aspectRatio: "1 / 1.414" }} />
            <div className="animate-pulse rounded-sm bg-muted" style={{ aspectRatio: "1 / 1.414" }} />
          </div>
        )}
      </div>
    </section>
  );
}
