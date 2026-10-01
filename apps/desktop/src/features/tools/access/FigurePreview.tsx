import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toRpcError } from "@/shared/rpc/client";
import { describeError } from "@/shared/lib/errorMessage";
import { previewAccessFigure } from "@/shared/rpc/operations";
import type { AccessFigurePreviewResult } from "@/types";

export type FigurePreviewCache = Map<string, AccessFigurePreviewResult>;

type Loaded = { key: string; preview: AccessFigurePreviewResult | null; error: string | null };

function figurePreviewKey(path: string, xref: number): string {
  return `${path}#${xref}`;
}

export function FigurePreview({ path, password, xref, cache }: { path: string; password?: string; xref: number; cache: FigurePreviewCache }) {
  const { t } = useTranslation();
  const key = figurePreviewKey(path, xref);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const cached = cache.get(key) ?? null;

  useEffect(() => {
    if (cache.has(key)) return;
    const controller = new AbortController();
    previewAccessFigure({ path, password, xref }, { signal: controller.signal }).then(
      (preview) => {
        if (controller.signal.aborted) return;
        cache.set(key, preview);
        setLoaded({ key, preview, error: null });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key, preview: null, error: describeError(t, toRpcError(error)) });
      },
    );
    return () => controller.abort();
  }, [cache, key, path, password, xref, t]);

  const current = cached ?? (loaded && loaded.key === key ? loaded.preview : null);
  const error = loaded && loaded.key === key ? loaded.error : null;

  if (error) {
    return <p className="text-xs text-muted-foreground">{t("tools.access.preview.unavailable")}</p>;
  }
  if (!current) {
    return (
      <div role="status" aria-busy className="size-24 animate-pulse rounded-md bg-muted">
        <span className="sr-only">{t("tools.access.preview.loading")}</span>
      </div>
    );
  }
  return (
    <figure className="flex flex-col gap-1">
      <img
        src={`data:image/png;base64,${current.image}`}
        alt={t("tools.access.preview.label", { page: current.page })}
        className="max-h-40 max-w-full self-start rounded-md border bg-card object-contain"
      />
      {!current.exact ? <figcaption className="text-xs text-muted-foreground">{t("tools.access.preview.approximate")}</figcaption> : null}
    </figure>
  );
}
