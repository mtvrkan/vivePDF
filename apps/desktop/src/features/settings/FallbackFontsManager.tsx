import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, Loader2, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { formatBytes } from "@/shared/lib/format";
import { toRpcError } from "@/shared/rpc/client";
import { fallbackFonts, fallbackFontsRemove, type FallbackFontsResult } from "@/shared/rpc/fallbackFonts";
import { downloadFontSet } from "@/shared/session/fallbackFonts";
import { useFallbackFontsStore } from "@/shared/store/fallbackFontsStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";

export function FallbackFontsManager() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const downloads = useFallbackFontsStore((state) => state.downloads);
  const [data, setData] = useState<FallbackFontsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fallbackFonts());
      setError(null);
    } catch (caught) {
      setError(describeError(t, toRpcError(caught)));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = removing !== null || Object.values(downloads).some((download) => download.state === "downloading");

  const download = async (fontSet: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const language = t(`settings.fallbackFonts.sets.${fontSet}`);
    const installed = await downloadFontSet(fontSet, controller.signal);
    if (abortRef.current === controller) abortRef.current = null;
    const after = useFallbackFontsStore.getState().downloads[fontSet];
    if (installed) toast("success", t("settings.fallbackFonts.downloaded", { language }));
    else if (after?.state === "failed") toast("error", describeError(t, after.error));
    else if (controller.signal.aborted) toast("info", t("settings.fallbackFonts.cancelled", { language }));
    await load();
  };

  const remove = async (fontSet: string) => {
    setRemoving(fontSet);
    try {
      await fallbackFontsRemove(fontSet);
      useFallbackFontsStore.getState().setDownload(fontSet, null);
      toast("success", t("settings.fallbackFonts.removed", { language: t(`settings.fallbackFonts.sets.${fontSet}`) }));
      await load();
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setRemoving(null);
    }
  };

  if (!data && !error) return <SkeletonCard lines={4} />;

  return (
    <div className="w-full py-2">
      {error ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-xs text-destructive">{error}</p>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      <ul className="grid gap-1 sm:grid-cols-2">
        {(data?.sets ?? []).map((item) => {
          const language = t(`settings.fallbackFonts.sets.${item.id}`);
          const state = downloads[item.id];
          const downloading = state?.state === "downloading";
          const received = downloading ? state.progress?.detail?.received : undefined;
          const total = downloading ? state.progress?.detail?.total : undefined;
          const percent = typeof received === "number" && typeof total === "number" && total > 0 ? Math.round((received / total) * 100) : 0;
          return (
            <li key={item.id} className={cn("nav-glass flex h-9 items-center gap-2 rounded-lg px-2 text-sm", item.installed && "glass-chip")}>
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", item.installed ? "tone-tile" : "bg-muted text-muted-foreground")}>
                {downloading || removing === item.id ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : item.installed ? (
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{language}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{formatBytes(item.bytes, locale)}</span>
              {downloading ? (
                <>
                  <span
                    className="h-1 w-12 shrink-0 overflow-hidden rounded-sm bg-muted"
                    role="progressbar"
                    aria-label={t("settings.fallbackFonts.progressLabel", { language })}
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span className="block h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${Math.max(percent, 8)}%` }} />
                  </span>
                  <IconButton icon={X} label={`${t("settings.fallbackFonts.cancel")}: ${language}`} onClick={() => abortRef.current?.abort()} />
                </>
              ) : item.installed ? (
                <IconButton icon={Trash2} label={`${t("settings.fallbackFonts.remove")}: ${language}`} disabled={busy} onClick={() => void remove(item.id)} />
              ) : (
                <IconButton icon={ArrowDownToLine} label={`${t("settings.fallbackFonts.download")}: ${language}`} disabled={busy} onClick={() => void download(item.id)} />
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={data?.directory}>
        {data?.directory ?? ""}
      </p>
    </div>
  );
}
