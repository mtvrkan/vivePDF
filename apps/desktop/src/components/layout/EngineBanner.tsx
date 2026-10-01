import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { useEngineStore } from "@/shared/store/engineStore";
import { describeError } from "@/shared/lib/errorMessage";

export const SLOW_START_MS = 4000;

export function EngineBanner() {
  const { t } = useTranslation();
  const status = useEngineStore((state) => state.status);
  const error = useEngineStore((state) => state.error);
  const check = useEngineStore((state) => state.check);
  const [dismissed, setDismissed] = useState(false);
  const [slowSince, setSlowSince] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => setSlowSince(status), SLOW_START_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (status === "loading" && slowSince === "loading") {
    return (
      <div role="status" className="flex h-row items-center gap-3 border-b border-border bg-muted px-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t("engine.starting")}</span>
      </div>
    );
  }

  if (status !== "error" || !error || dismissed) return null;

  return (
    <div role="alert" className="flex h-row items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
      <span title={t("engine.failed", { reason: describeError(t, error) })} className="min-w-0 flex-1 truncate">
        {t("engine.failed", { reason: describeError(t, error) })}
      </span>
      <Button size="sm" onClick={() => void check()}>
        {t("common.retry")}
      </Button>
      <button type="button" onClick={() => setDismissed(true)} aria-label={t("common.close")} className="text-muted-foreground hover:text-foreground">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
