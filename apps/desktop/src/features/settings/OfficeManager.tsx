import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { formatBytes } from "@/shared/lib/format";
import { toRpcError } from "@/shared/rpc/client";
import { officeInstall, officeRemove, officeStatus, type OfficeStatusResult } from "@/shared/rpc/office";
import { useToastStore } from "@/shared/store/toastStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { RpcProgress } from "@/types";

export function OfficeManager() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const refreshTools = useToolsStatusStore((state) => state.refresh);
  const [status, setStatus] = useState<OfficeStatusResult | null>(null);
  const [busy, setBusy] = useState<"install" | "remove" | null>(null);
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await officeStatus());
      setError(null);
    } catch (caught) {
      setError(describeError(t, toRpcError(caught)));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async () => {
    setBusy("install");
    setProgress(null);
    setError(null);
    try {
      setStatus(await officeInstall({ onProgress: setProgress }));
      toast("success", t("settings.office.installed"));
      void refreshTools();
    } catch (caught) {
      setError(describeError(t, toRpcError(caught)));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);
    try {
      setStatus(await officeRemove());
      toast("success", t("settings.office.removed"));
      void refreshTools();
    } catch (caught) {
      setError(describeError(t, toRpcError(caught)));
    } finally {
      setBusy(null);
    }
  };

  const received = progress?.detail?.received;
  const total = progress?.detail?.total;
  const percent = typeof received === "number" && typeof total === "number" && total > 0 ? Math.round((received / total) * 100) : null;
  const managed = status?.source === "managed";
  const stateLabel = !status
    ? "…"
    : status.source === "managed"
      ? t("settings.office.managed")
      : status.source === "system"
        ? t("settings.office.system")
        : t("settings.office.notInstalled");

  return (
    <div className="w-full space-y-3">
      <div className="glass-flat flex flex-wrap items-center gap-3 rounded-xl border p-3">
        <span className={cn("size-2 shrink-0 rounded-full", status?.installed ? "bg-success" : "bg-muted-foreground", busy === "install" && "animate-pulse bg-warning")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-foreground">{stateLabel}</span>
          <span className="block break-all text-xs leading-4 text-muted-foreground">
            {busy === "install"
              ? `${t("progress.downloading")}${percent !== null ? ` ${percent}%` : ""}`
              : managed
                ? `${status?.path ?? ""} · ${formatBytes(status?.sizeBytes ?? 0, locale)}`
                : (status?.path ?? t("settings.office.downloadHint"))}
          </span>
        </span>
        {status?.supported === false ? null : status?.source === "system" ? null : managed ? (
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => void remove()} loading={busy === "remove"} disabled={busy !== null}>
            {t("settings.office.remove")}
          </Button>
        ) : (
          <Button size="sm" icon={busy === "install" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowDownToLine className="size-4" aria-hidden />} onClick={() => void install()} disabled={busy !== null}>
            {busy === "install" ? t("progress.installing") : t("settings.office.install")}
          </Button>
        )}
      </div>
      {busy === "install" ? (
        <div className="h-1 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${percent ?? 8}%` }} />
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {status?.supported === false ? <p className="text-xs text-muted-foreground">{t("settings.office.unsupported")}</p> : null}
    </div>
  );
}
