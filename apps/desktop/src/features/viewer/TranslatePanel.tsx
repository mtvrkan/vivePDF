import { useEffect, useMemo } from "react";
import { ArrowDownToLine, ArrowLeftRight, Copy, ExternalLink, Languages, RefreshCw, Settings2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { describeError } from "@/shared/lib/errorMessage";
import { openExternal } from "@/shared/lib/openExternal";
import { languageName, languagePacks, localeOfLanguage, PIVOT_LANGUAGE, packsForMissing } from "@/shared/lib/translateLanguage";
import { translateUrl } from "@/shared/lib/webSearch";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { useTranslateModelsStore } from "@/shared/store/translateModelsStore";
import { MAX_TRANSLATION_CHARS, useTranslationStore } from "@/shared/store/translationStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";

function TextSkeleton() {
  return (
    <div aria-hidden className="animate-pulse space-y-2 py-1">
      {["100%", "80%", "60%"].map((width) => (
        <div key={width} className="h-4 rounded-sm bg-muted" style={{ width }} />
      ))}
    </div>
  );
}

function MissingLanguages({ ids }: { ids: string[] }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const models = useTranslateModelsStore((state) => state.models);
  const downloadingLanguage = useTranslateModelsStore((state) => state.downloadingLanguage);
  const downloadProgress = useTranslateModelsStore((state) => state.downloadProgress);
  const downloadLanguage = useTranslateModelsStore((state) => state.downloadLanguage);
  const cancelDownload = useTranslateModelsStore((state) => state.cancelDownload);
  const run = useTranslationStore((state) => state.run);
  const wanted = packsForMissing(ids);
  const packs = languagePacks(models).filter((pack) => wanted.includes(pack.code) && pack.state !== "full");

  const download = async (code: string) => {
    try {
      await downloadLanguage(code);
      const installed = new Set(useTranslateModelsStore.getState().models.filter((model) => model.installed).map((model) => model.id));
      if (ids.every((id) => installed.has(id))) void run();
    } catch (caught) {
      const rpcError = toRpcError(caught);
      if (rpcError.code === "CANCELLED") toast("info", t("settings.translate.downloadCancelled"));
      else toast("error", describeError(t, rpcError));
    }
  };

  if (packs.length === 0) return null;
  const percent = downloadProgress ? Math.round(downloadProgress.progress * 100) : 0;
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {packs.map((pack) => {
        const name = languageName(pack.code, locale);
        const working = downloadingLanguage === pack.code;
        return (
          <li key={pack.code} className="nav-glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{t("viewer.translate.languagePack", { language: name })}</span>
            {working ? (
              <>
                <span className="h-1 w-16 shrink-0 overflow-hidden rounded-sm bg-muted" role="progressbar" aria-label={t("settings.translate.progressLabel", { name })} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                  <span className="block h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${Math.max(percent, 4)}%` }} />
                </span>
                <IconButton icon={X} label={`${t("settings.translate.cancelDownload")}: ${name}`} onClick={cancelDownload} />
              </>
            ) : (
              <Button size="sm" icon={<ArrowDownToLine className="size-4" aria-hidden />} onClick={() => void download(pack.code)} disabled={downloadingLanguage !== null}>
                {t("viewer.translate.downloadSize", { size: pack.missingSizeMb })}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function TranslatePanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const setPanels = useViewerPanelsStore((state) => state.setPanels);
  const models = useTranslateModelsStore((state) => state.models);
  const modelsLoaded = useTranslateModelsStore((state) => state.loaded);
  const modelsLoading = useTranslateModelsStore((state) => state.loading);
  const modelsError = useTranslateModelsStore((state) => state.error);
  const refreshModels = useTranslateModelsStore((state) => state.refresh);
  const text = useTranslationStore((state) => state.text);
  const truncated = useTranslationStore((state) => state.truncated);
  const source = useTranslationStore((state) => state.source);
  const target = useTranslationStore((state) => state.target);
  const status = useTranslationStore((state) => state.status);
  const progress = useTranslationStore((state) => state.progress);
  const result = useTranslationStore((state) => state.result);
  const error = useTranslationStore((state) => state.error);
  const setPair = useTranslationStore((state) => state.setPair);
  const swap = useTranslationStore((state) => state.swap);
  const run = useTranslationStore((state) => state.run);
  const cancel = useTranslationStore((state) => state.cancel);

  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (!modelsLoaded && !modelsLoading) void refreshModels();
  }, [modelsLoaded, modelsLoading, refreshModels]);

  const languages = useMemo(() => {
    const ready = new Set([PIVOT_LANGUAGE, ...languagePacks(models).filter((pack) => pack.state === "full").map((pack) => pack.code)]);
    for (const model of models) if (model.installed && model.origin === "custom") [model.source, model.target].forEach((code) => ready.add(code));
    const codes = new Set(models.flatMap((model) => [model.source, model.target]));
    return Array.from(codes)
      .map((code) => ({ value: code, label: languageName(code, locale), ready: ready.has(code) }))
      .sort((a, b) => Number(b.ready) - Number(a.ready) || a.label.localeCompare(b.label, locale))
      .map(({ value, label }) => ({ value, label }));
  }, [models, locale]);

  const close = () => {
    cancel();
    setPanels((panels) => ({ ...panels, translate: false }));
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      toast("success", t("viewer.selection.copied"));
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    }
  };

  const openWeb = async () => {
    try {
      await openExternal(translateUrl(text, locale));
    } catch {
      toast("error", t("viewer.link.openFailed"));
    }
  };

  const installedCount = models.filter((model) => model.installed).length;
  const missing = error?.data?.reason === "translationPairMissing" && Array.isArray(error.data.missing) ? (error.data.missing as string[]) : [];
  const percent = progress === null ? null : Math.round(progress * 100);

  const body = () => {
    if (!modelsLoaded || (modelsLoading && models.length === 0)) return <TextSkeleton />;
    if (modelsError) {
      return (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p className="text-destructive">{modelsError}</p>
          <Button size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => void refreshModels()}>
            {t("common.retry")}
          </Button>
        </div>
      );
    }
    if (installedCount === 0) {
      return (
        <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
          <Languages className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">{t("viewer.translate.noModelsTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("viewer.translate.noModelsDescription")}</p>
          <Button size="sm" variant="primary" icon={<Settings2 className="size-4" aria-hidden />} onClick={() => void navigate("/settings?section=reading")}>
            {t("viewer.translate.openSettings")}
          </Button>
        </div>
      );
    }
    if (!text) {
      return (
        <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
          <Languages className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">{t("viewer.translate.emptyTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("viewer.translate.emptyDescription")}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <details className="rounded-xl border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t("viewer.translate.original")}</summary>
          <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground" lang={source ? localeOfLanguage(source) : undefined}>
            {text}
          </p>
        </details>
        {truncated ? <p className="text-xs text-muted-foreground">{t("viewer.translate.truncated", { limit: MAX_TRANSLATION_CHARS })}</p> : null}
        <section aria-live="polite" aria-busy={status === "loading"} aria-label={t("viewer.translate.result")} className="min-h-16">
          {status === "loading" ? (
            <div className="flex flex-col gap-2">
              <TextSkeleton />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex-1">{percent === null ? t("progress.translating") : `${t("progress.translating")} ${percent}%`}</span>
                <Button size="sm" variant="ghost" onClick={cancel}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : null}
          {status === "done" && result ? (
            <div className="flex flex-col gap-2">
              <p className="whitespace-pre-wrap text-sm leading-relaxed" lang={localeOfLanguage(result.target)}>
                {result.text}
              </p>
              <div className="flex items-center gap-2">
                {result.route.length > 1 ? <span className="glass-chip rounded-full px-2 py-0.5 text-[11px] text-muted-foreground">{t("viewer.translate.viaEnglish")}</span> : null}
                <span className="flex-1" />
                <IconButton icon={Copy} label={t("viewer.translate.copy")} onClick={() => void copy()} />
              </div>
            </div>
          ) : null}
          {status === "error" && error ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-destructive">{describeError(t, error)}</p>
              {missing.length > 0 ? <MissingLanguages ids={missing} /> : (
                <Button size="sm" className="self-start" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => void run()}>
                  {t("common.retry")}
                </Button>
              )}
            </div>
          ) : null}
          {status === "idle" && (!source || !target) ? <p className="text-sm text-muted-foreground">{t("viewer.translate.pickLanguages")}</p> : null}
          {status === "idle" && source && target ? (
            <Button size="sm" variant="primary" icon={<Languages className="size-4" aria-hidden />} onClick={() => void run()}>
              {t("viewer.translate.run")}
            </Button>
          ) : null}
        </section>
      </div>
    );
  };

  return (
    <aside aria-label={t("viewer.translate.title")} className="flex h-full w-inspector flex-col border-s bg-card">
      <div className="flex h-row items-center gap-2 border-b px-3">
        <Languages className="size-4 text-primary" aria-hidden />
        <span className="flex-1 text-sm font-semibold">{t("viewer.translate.title")}</span>
        <IconButton icon={X} label={t("common.close")} onClick={close} />
      </div>
      {installedCount > 0 ? (
        <div className="flex items-center gap-1.5 border-b p-3">
          <Select value={source ?? ""} options={languages} onChange={(value) => setPair({ source: value || null })} ariaLabel={t("viewer.translate.source")} placeholder={t("viewer.translate.source")} searchable searchPlaceholder={t("settings.translate.search")} size="sm" className="min-w-0 flex-1" />
          <IconButton icon={ArrowLeftRight} label={t("viewer.translate.swap")} onClick={swap} disabled={!source || !target} />
          <Select value={target ?? ""} options={languages} onChange={(value) => setPair({ target: value || null })} ariaLabel={t("viewer.translate.target")} placeholder={t("viewer.translate.target")} searchable searchPlaceholder={t("settings.translate.search")} size="sm" className="min-w-0 flex-1" />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-3">{body()}</div>
      {text ? (
        <div className="flex items-center gap-2 border-t p-3">
          <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" aria-hidden />} onClick={() => void openWeb()}>
            {t("viewer.translate.openWeb")}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
