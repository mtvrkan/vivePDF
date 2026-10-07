import { memo, useEffect, useRef, useState } from "react";
import { FileImage, FileWarning, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PdfErrorCode } from "@embedpdf/models";
import { useRenderCapability } from "@embedpdf/plugin-render/react";
import { cn } from "@/shared/lib/cn";
import { readDocumentBytes } from "@/shared/rpc/files";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { OrganizerSource, OrganizerTile } from "@/types";
import { PaperPreview } from "./PaperPreview";
import { thumbnails } from "./thumbnailCache";
import { thumbnailScale } from "./thumbnailScale";
import { observeVisibility } from "./sharedVisibility";
import { useOrganizerStore } from "./organizerStore";

const RENDER_SETTLE_MS = 120;

function RenderedPage({ documentId, pageIndex, width, height }: { documentId: string; pageIndex: number; width: number; height: number }) {
  const { provides: render } = useRenderCapability();
  const pageSize = useDocumentStore((state) => state.documents[documentId]?.info?.pageSizes[pageIndex] ?? null);
  const scale = thumbnailScale({ width, height }, pageSize, window.devicePixelRatio);
  const key = `${documentId}:${pageIndex}:${scale}`;
  const [url, setUrl] = useState<string | null>(() => thumbnails.recall(key));
  const [visible, setVisible] = useState(false);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    thumbnails.retain(key);
    return () => thumbnails.release(key);
  }, [key]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observeVisibility(element, setVisible);
  }, []);

  useEffect(() => {
    const cached = thumbnails.recall(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    if (!visible || !render) return;
    let cancelled = false;
    let task: ReturnType<ReturnType<typeof render.forDocument>["renderPage"]> | null = null;
    const timer = window.setTimeout(() => {
      try {
        task = render.forDocument(documentId).renderPage({ pageIndex, options: { scaleFactor: scale, imageType: "image/webp" } });
      } catch {
        setFailedKey(key);
        return;
      }
      task.wait(
        (blob) => {
          if (cancelled) return;
          const objectUrl = URL.createObjectURL(blob);
          thumbnails.remember(key, objectUrl);
          setUrl(objectUrl);
        },
        () => {
          if (!cancelled) setFailedKey(key);
        },
      );
    }, RENDER_SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      try {
        task?.abort({ code: PdfErrorCode.Cancelled, message: "thumbnail left the view" });
      } catch {
        return;
      }
    };
  }, [visible, render, documentId, pageIndex, scale, key]);

  return (
    <div ref={ref} className="flex size-full items-center justify-center">
      {url ? (
        <img src={url} alt="" draggable={false} decoding="async" className="max-h-full max-w-full object-contain shadow-none" />
      ) : failedKey === key ? (
        <FileWarning role="img" aria-label={t("tools.pages.previewFailed")} className="size-8 text-muted-foreground" />
      ) : (
        <div className="size-full animate-pulse bg-muted" />
      )}
    </div>
  );
}

function ImagePreview({ path, previewUrl }: { path: string; previewUrl: string }) {
  const key = `image:${path}`;
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const url = previewUrl || (loaded?.path === path ? loaded.url : null);

  useEffect(() => {
    if (previewUrl) return;
    thumbnails.retain(key);
    const cached = thumbnails.recall(key);
    let cancelled = false;
    if (cached) setLoaded({ path, url: cached });
    else
      void readDocumentBytes(path).then(
        (bytes) => {
          if (cancelled) return;
          const objectUrl = URL.createObjectURL(new Blob([bytes]));
          thumbnails.remember(key, objectUrl);
          setLoaded({ path, url: objectUrl });
        },
        () => {
          if (!cancelled) setLoaded({ path, url: null });
        },
      );
    return () => {
      cancelled = true;
      thumbnails.release(key);
    };
  }, [key, path, previewUrl]);

  if (!url || broken === url) return <FileImage className="size-8 text-muted-foreground" aria-hidden />;
  return <img src={url} alt="" draggable={false} decoding="async" onError={() => setBroken(url)} className="max-h-[88%] max-w-[88%] border bg-card object-contain" />;
}

type PageThumbnailProps = {
  tile: OrganizerTile;
  sources: Record<string, OrganizerSource>;
  width: number;
  height: number;
  className?: string;
};

export const PageThumbnail = memo(function PageThumbnail({ tile, sources, width, height, className }: PageThumbnailProps) {
  const { t } = useTranslation();
  const unavailable = useOrganizerStore((state) => tile.kind === "page" && state.unavailable.has(tile.sourceId));
  const rotated = tile.rotate === 90 || tile.rotate === 270;
  return (
    <div style={{ height }} className={cn("flex items-center justify-center overflow-hidden bg-muted", className)}>
      <div
        style={{ transform: `rotate(${tile.rotate}deg)`, width: rotated ? "70%" : "100%", height: rotated ? "100%" : "100%" }}
        className="flex items-center justify-center transition-transform duration-(--transition-fast)"
      >
        {tile.kind === "page" ? (
          sources[tile.sourceId]?.embedDocId ? (
            <RenderedPage documentId={sources[tile.sourceId].embedDocId as string} pageIndex={tile.index - 1} width={width} height={height} />
          ) : unavailable ? (
            <Lock role="img" aria-label={t("tools.pages.sourceUnavailable")} className="size-8 text-muted-foreground" />
          ) : (
            <div className="size-full animate-pulse bg-muted" />
          )
        ) : null}
        {tile.kind === "blank" ? (
          <div
            className="border bg-card"
            style={{ aspectRatio: `${tile.width} / ${tile.height}`, maxWidth: "88%", maxHeight: "88%", width: tile.width >= tile.height ? "88%" : undefined, height: tile.width < tile.height ? "88%" : undefined }}
          >
            {tile.paper ? <PaperPreview width={tile.width} height={tile.height} paper={tile.paper} className="size-full" /> : null}
          </div>
        ) : null}
        {tile.kind === "image" ? <ImagePreview path={tile.path} previewUrl={tile.previewUrl} /> : null}
      </div>
    </div>
  );
});
