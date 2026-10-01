import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { shapeDataUrl } from "../shapes/render";
import type { EnginePreviewResult, EnginePreviewState } from "./useEnginePreview";

type EnginePreviewProps = {
  state: EnginePreviewState<EnginePreviewResult>;
  blank: boolean;
  onRetry: () => void;
  label: string;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyText: string;
};

export function EnginePreview({ state, blank, onRetry, label, emptyIcon: EmptyIcon, emptyTitle, emptyText }: EnginePreviewProps) {
  const { t } = useTranslation();
  const result = state.result;
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div role="img" aria-label={label} aria-busy={state.loading || undefined} className="paper-surface flex h-72 items-center justify-center overflow-hidden rounded-xl border bg-white p-4">
        {blank ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <EmptyIcon className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
            <p className="max-w-60 text-xs text-muted-foreground">{emptyText}</p>
          </div>
        ) : result ? (
          <img src={shapeDataUrl(result.svg)} alt="" draggable={false} className={cn("max-h-full max-w-full object-contain transition-opacity duration-(--transition-fast)", state.loading && "opacity-60")} />
        ) : state.error ? null : (
          <div className="flex w-full flex-col gap-2" data-testid="engine-preview-skeleton">
            {[0, 1, 2, 3].map((line) => (
              <div key={line} className="h-5 w-full animate-pulse rounded bg-muted" />
            ))}
          </div>
        )}
      </div>
      {state.error && !blank ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <span>{describeError(t, state.error)}</span>
          <Button size="sm" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {result?.missingGlyphs && !blank ? <p className="text-xs text-warning">{t("viewer.grid.missingGlyphs", { glyphs: result.missingGlyphs })}</p> : null}
    </div>
  );
}
