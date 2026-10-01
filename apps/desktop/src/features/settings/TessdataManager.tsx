import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Check, Loader2, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { toRpcError } from "@/shared/rpc/client";
import { tessdataDownload, tessdataLanguages, tessdataRemove, type TessdataLanguagesResult } from "@/shared/rpc/tessdata";
import { useToastStore } from "@/shared/store/toastStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import type { RpcProgress } from "@/types";
import { describeError } from "@/shared/lib/errorMessage";
import { tesseractLanguageName } from "@/app/locales";

const PROTECTED_CODES = new Set(["eng", "tur"]);

export function TessdataManager() {
  const { t, i18n } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const refreshTools = useToolsStatusStore((state) => state.refresh);
  const [data, setData] = useState<TessdataLanguagesResult | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await tessdataLanguages());
      setError(null);
    } catch (caught) {
      const rpcError = toRpcError(caught);
      setError(describeError(t, rpcError));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (code: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(code);
    setProgress(null);
    try {
      await tessdataDownload(code, { onProgress: setProgress, signal: controller.signal });
      toast("success", t("settings.tessdata.downloaded", { code }));
      await load();
      void refreshTools();
    } catch (caught) {
      const rpcError = toRpcError(caught);
      if (rpcError.code === "CANCELLED") toast("info", t("settings.tessdata.cancelled", { code }));
      else toast("error", describeError(t, rpcError));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(null);
      setProgress(null);
    }
  };

  const cancelDownload = () => abortRef.current?.abort();

  const remove = async (code: string) => {
    setBusy(code);
    try {
      await tessdataRemove(code);
      toast("success", t("settings.tessdata.removed", { code }));
      await load();
      void refreshTools();
    } catch (caught) {
      const rpcError = toRpcError(caught);
      toast("error", describeError(t, rpcError));
    } finally {
      setBusy(null);
    }
  };

  const installed = useMemo(() => new Set(data?.installed ?? []), [data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const list = (data?.available ?? []).map((item) => ({ ...item, name: tesseractLanguageName(item.code, i18n.language, item.name), englishName: item.name }));
    return needle ? list.filter((item) => item.code.includes(needle) || item.name.toLocaleLowerCase().includes(needle) || item.englishName.toLocaleLowerCase().includes(needle)) : list;
  }, [data, query, i18n.language]);
  const received = progress?.detail?.received;
  const total = progress?.detail?.total;
  const percent = typeof received === "number" && typeof total === "number" && total > 0 ? Math.round((received / total) * 100) : null;

  return (
    <div className="w-full py-2">
      <div className="flex items-center gap-3">
        <span className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.tessdata.search")} aria-label={t("settings.tessdata.search")} className="h-9 ps-9 text-sm" />
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{t("settings.tessdata.installedCount", { count: installed.size })}</span>
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <ul className="mt-2 grid max-h-72 gap-1 overflow-auto pe-1 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => {
          const isInstalled = installed.has(item.code);
          const isBusy = busy === item.code;
          return (
            <li key={item.code} className={cn("nav-glass flex h-9 items-center gap-2 rounded-lg px-2 text-sm", isInstalled && "glass-chip")}>
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", isInstalled ? "tone-tile" : "bg-muted text-muted-foreground")}>
                {isBusy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : isInstalled ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{item.code}</span>
              {isBusy && !isInstalled ? (
                <span className="flex w-16 shrink-0 items-center gap-1.5">
                  <span
                    className="h-1 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted"
                    role="progressbar"
                    aria-label={t("settings.tessdata.progressLabel", { name: item.name })}
                    aria-valuenow={percent ?? undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span className="block h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${percent ?? 8}%` }} />
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{percent ?? 0}%</span>
                </span>
              ) : null}
              {isBusy && !isInstalled ? (
                <IconButton icon={X} label={`${t("settings.tessdata.cancel")}: ${item.name}`} onClick={cancelDownload} />
              ) : isInstalled ? (
                <IconButton icon={Trash2} label={`${t("settings.tessdata.remove")}: ${item.name}`} disabled={busy !== null || PROTECTED_CODES.has(item.code)} onClick={() => void remove(item.code)} />
              ) : (
                <IconButton icon={ArrowDownToLine} label={`${t("settings.tessdata.download")}: ${item.name}`} disabled={busy !== null} onClick={() => void download(item.code)} />
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={data?.directory}>
          {data?.directory ?? ""}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy !== null}>
          {t("settings.tessdata.refresh")}
        </Button>
      </div>
    </div>
  );
}
