import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { toRpcError } from "@/shared/rpc/client";
import { previewStamp, previewWatermark } from "@/shared/rpc/operations";
import { describeError } from "@/shared/lib/errorMessage";
import type { MarkPreviewResult, StampPreviewParams, WatermarkPreviewParams } from "@/types";

const DEBOUNCE_MS = 350;
const PREVIEW_WIDTH = 460;

export type MarkRequest = { kind: "watermark"; params: WatermarkPreviewParams } | { kind: "stamp"; params: StampPreviewParams };

export function MarkPreview({ request }: { request: MarkRequest }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<MarkPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const key = JSON.stringify(request);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const current = JSON.parse(key) as MarkRequest;
      const call = current.kind === "watermark" ? previewWatermark({ ...current.params, width: PREVIEW_WIDTH }) : previewStamp({ ...current.params, width: PREVIEW_WIDTH });
      void call
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          setMessage(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setPreview(null);
          setMessage(describeError(t, toRpcError(error)));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [key, t]);

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b px-4 pb-3 pt-4">
        <p className="min-w-0 flex-1 text-sm font-medium">{t("tools.security.preview.title")}</p>
        {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : null}
        {preview ? <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{t("tools.security.preview.page", { page: preview.page, total: preview.pageCount })}</p> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4" aria-live="polite" aria-busy={loading}>
        {preview ? (
          <img
            src={`data:image/png;base64,${preview.image}`}
            width={preview.width}
            height={preview.height}
            alt={t("tools.security.preview.title")}
            className={cn("mx-auto h-auto w-full rounded-lg border shadow-(--shadow-card) transition-opacity duration-(--transition-fast)", loading && "opacity-60")}
          />
        ) : null}
        {!preview && message ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">{message}</p> : null}
        {!preview && !message ? <div className="mx-auto aspect-[1/1.414] w-full animate-pulse rounded-lg border bg-muted" /> : null}
      </div>
      {preview?.pagesProblem ? (
        <p className="border-t px-4 py-3 text-xs text-warning">{t(`tools.security.preview.pagesProblem.${preview.pagesProblem}`)}</p>
      ) : null}
      {preview?.missingGlyphs ? (
        <p className="border-t px-4 py-3 text-xs text-warning">{t("fontPicker.missing", { chars: preview.missingGlyphs })}</p>
      ) : null}
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t("tools.security.preview.hint")}</p>
    </div>
  );
}
