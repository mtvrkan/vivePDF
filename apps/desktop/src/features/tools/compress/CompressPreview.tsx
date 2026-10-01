import { useEffect, useRef, useState, type UIEvent } from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Checkbox } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { formatBytes, formatNumber } from "@/shared/lib/format";
import { toRpcError } from "@/shared/rpc/client";
import { previewCompress } from "@/shared/rpc/operations";
import { useUiStore } from "@/shared/store/uiStore";
import type { CompressPreviewParams, CompressPreviewResult, RpcError } from "@/types";

const REFRESH_DELAY_MS = 400;
const OVERVIEW_DPI = 90;
const ZOOM_DPI = 200;

type PreviewSettings = Omit<CompressPreviewParams, "page" | "dpi">;
type PreviewState = { loading: boolean; result: CompressPreviewResult | null; error: RpcError | null };

export function CompressPreview({ settings, pageCount, disabled }: { settings: PreviewSettings; pageCount?: number; disabled?: boolean }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [active, setActive] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>({ loading: false, result: null, error: null });
  const panes = useRef<(HTMLDivElement | null)[]>([]);
  const key = JSON.stringify({ ...settings, page: page - 1, dpi: zoomed ? ZOOM_DPI : OVERVIEW_DPI });
  const total = state.result?.pageCount ?? pageCount ?? 1;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, loading: true, error: null }));
      previewCompress(JSON.parse(key) as CompressPreviewParams, { signal: controller.signal })
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
  }, [key, active, attempt]);

  const followScroll = (from: number) => (event: UIEvent<HTMLDivElement>) => {
    const other = panes.current[1 - from];
    if (!other) return;
    other.scrollTop = event.currentTarget.scrollTop;
    other.scrollLeft = event.currentTarget.scrollLeft;
  };

  const result = state.result;
  const figures = result
    ? [
        { label: t("tools.compress.preview.before"), src: result.before },
        { label: t("tools.compress.preview.after"), src: result.after },
      ]
    : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {active ? null : (
          <Button icon={<Eye className="size-4" aria-hidden />} disabled={disabled} onClick={() => setActive(true)}>
            {t("tools.compress.preview.run")}
          </Button>
        )}
        {active && total > 1 ? (
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} className="rtl:-scale-x-100" label={t("tools.compress.preview.previous")} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} />
            <span className="min-w-24 text-center text-sm tabular-nums text-muted-foreground" role="status">
              {t("tools.compress.preview.page", { page: formatNumber(page, locale), total: formatNumber(total, locale) })}
            </span>
            <IconButton icon={ChevronRight} className="rtl:-scale-x-100" label={t("tools.compress.preview.next")} disabled={page >= total} onClick={() => setPage((value) => Math.min(total, value + 1))} />
          </div>
        ) : null}
        {active ? <Checkbox label={t("tools.compress.preview.zoom")} checked={zoomed} onChange={setZoomed} /> : null}
      </div>
      {active ? (
        <div aria-live="polite" aria-busy={state.loading || undefined} className="flex flex-col gap-2">
          {state.error ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
              <span>{describeError(t, state.error)}</span>
              <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          {result ? (
            <>
              <div className={cn("grid grid-cols-2 gap-3 transition-opacity duration-(--transition-fast)", state.loading && "opacity-60")}>
                {figures.map((figure, index) => (
                  <figure key={figure.label} className="flex min-w-0 flex-col gap-1">
                    <div
                      ref={(element) => {
                        panes.current[index] = element;
                      }}
                      onScroll={zoomed ? followScroll(index) : undefined}
                      tabIndex={zoomed ? 0 : undefined}
                      aria-label={zoomed ? figure.label : undefined}
                      className={cn("rounded-md border", zoomed && "max-h-96 overflow-auto")}
                    >
                      <img src={`data:image/jpeg;base64,${figure.src}`} width={result.width} height={result.height} alt={figure.label} className={cn("block", zoomed ? "max-w-none" : "h-auto w-full")} />
                    </div>
                    <figcaption className="text-xs font-medium text-muted-foreground">{figure.label}</figcaption>
                  </figure>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("tools.compress.preview.size", { before: formatBytes(result.bytesBefore, locale), after: formatBytes(result.bytesAfter, locale) })}
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
