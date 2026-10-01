import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { formatNumber } from "@/shared/lib/format";
import { toRpcError } from "@/shared/rpc/client";
import { previewScanEnhance } from "@/shared/rpc/operations";
import { useUiStore } from "@/shared/store/uiStore";
import type { RpcError, ScanEnhancePreviewParams, ScanEnhancePreviewResult } from "@/types";

const REFRESH_DELAY_MS = 350;

type PreviewSettings = Omit<ScanEnhancePreviewParams, "page" | "dpi">;
type PreviewState = { loading: boolean; result: ScanEnhancePreviewResult | null; error: RpcError | null };

type ScanEnhancePreviewProps = {
  settings: PreviewSettings;
  pageCount?: number;
  ready: boolean;
  disabled?: boolean;
};

export function ScanEnhancePreview({ settings, pageCount, ready, disabled }: ScanEnhancePreviewProps) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [active, setActive] = useState(false);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>({ loading: false, result: null, error: null });
  const key = JSON.stringify({ ...settings, page: page - 1 });
  const total = state.result?.pageCount ?? pageCount ?? 1;

  useEffect(() => {
    if (!active || !ready) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, loading: true, error: null }));
      previewScanEnhance(JSON.parse(key) as ScanEnhancePreviewParams, { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) setState({ loading: false, result, error: null });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, error: toRpcError(error) }));
        });
    }, REFRESH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, active, ready, attempt]);

  const result = state.result;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {active ? null : (
          <Button icon={<Eye className="size-4" aria-hidden />} disabled={!ready || disabled} onClick={() => setActive(true)}>
            {t("tools.scan.enhance.preview.run")}
          </Button>
        )}
        {active && total > 1 ? (
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} className="rtl:-scale-x-100" label={t("tools.scan.enhance.preview.previous")} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} />
            <span className="min-w-24 text-center text-sm tabular-nums text-muted-foreground" role="status">
              {t("tools.scan.enhance.preview.page", { page: formatNumber(page, locale), total: formatNumber(total, locale) })}
            </span>
            <IconButton icon={ChevronRight} className="rtl:-scale-x-100" label={t("tools.scan.enhance.preview.next")} disabled={page >= total} onClick={() => setPage((value) => Math.min(total, value + 1))} />
          </div>
        ) : null}
      </div>
      {active ? (
        <div aria-live="polite" aria-busy={state.loading || undefined} className="flex flex-col gap-2">
          {state.error ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
              <span>{describeError(t, state.error)}</span>
              <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {result ? (
            <>
              <div className={cn("grid grid-cols-2 gap-3 transition-opacity duration-(--transition-fast)", state.loading && "opacity-60")}>
                <PreviewFigure label={t("tools.scan.enhance.preview.before")} src={`data:image/jpeg;base64,${result.before}`} width={result.width} height={result.height} />
                <PreviewFigure label={t("tools.scan.enhance.preview.after")} src={`data:image/${result.afterFormat};base64,${result.after}`} width={result.width} height={result.height} />
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  result.angle ? t("tools.scan.enhance.preview.angle", { angle: formatNumber(Math.abs(result.angle), locale) }) : t("tools.scan.enhance.preview.straight"),
                  settings.mode === "auto" ? t("tools.scan.enhance.preview.detected", { mode: t(`tools.scan.enhance.modes.${result.mode}.title`) }) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          ) : state.loading ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((item) => (
                <div key={item} className="aspect-3/4 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PreviewFigure({ label, src, width, height }: { label: string; src: string; width: number; height: number }) {
  return (
    <figure className="flex flex-col gap-1">
      <img src={src} width={width} height={height} alt={label} className="h-auto w-full rounded-md border" />
      <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>
    </figure>
  );
}
