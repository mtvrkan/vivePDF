import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, FolderOpen, Loader2, Minus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { revealPath } from "@/shared/lib/reveal";
import { type LanguagePack, languageName, languagePacks, pairLanguages } from "@/shared/lib/translateLanguage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { useTranslateModelsStore } from "@/shared/store/translateModelsStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { TranslateModel } from "@/types";

type Filter = "all" | "installed";

function ProgressBar({ label, percent }: { label: string; percent: number }) {
  return (
    <span className="h-1 w-16 shrink-0 overflow-hidden rounded-sm bg-muted" role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <span className="block h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${Math.max(percent, 4)}%` }} />
    </span>
  );
}

function StateMark({ state, working }: { state: LanguagePack["state"]; working: boolean }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border",
        state === "full" ? "border-primary bg-primary text-primary-foreground" : state === "partial" ? "border-primary text-primary" : "border-border",
      )}
    >
      {working ? <Loader2 className="size-3 animate-spin" aria-hidden /> : state === "full" ? <Check className="size-3" aria-hidden /> : state === "partial" ? <Minus className="size-3" aria-hidden /> : null}
    </span>
  );
}

function LanguageRow({ pack, locale, working, percent, busy, onDownload, onRemove, onCancel }: {
  pack: LanguagePack;
  locale: string;
  working: boolean;
  percent: number;
  busy: boolean;
  onDownload: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const name = languageName(pack.code, locale);
  const size = pack.state === "partial" ? pack.missingSizeMb : pack.sizeMb;
  return (
    <li className={cn("flex h-11 items-center gap-3 border-b text-sm last:border-b-0", pack.state === "none" ? "text-foreground/80" : "text-foreground")}>
      <StateMark state={pack.state} working={working} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2 truncate" title={pack.code}>
        <span className="truncate">{name}</span>
        {pack.state === "partial" && !working ? <span className="truncate text-xs text-muted-foreground">{t("settings.translate.partial")}</span> : null}
      </span>
      {pack.version ? <span className="rounded-md border bg-background/60 px-1.5 font-mono text-[11px] text-muted-foreground">v{pack.version}</span> : null}
      {working ? <ProgressBar label={t("settings.translate.progressLabel", { name })} percent={percent} /> : null}
      <span className="w-16 text-end font-mono text-xs tabular-nums text-muted-foreground">{working ? `${percent}%` : `${size} MB`}</span>
      <span className="flex items-center justify-end gap-1">
        {pack.state === "partial" && !working ? (
          <Button size="sm" variant="secondary" aria-label={`${t("settings.translate.complete")}: ${name}`} onClick={onDownload} disabled={busy}>
            {t("settings.translate.complete")}
          </Button>
        ) : null}
        {working ? (
          <IconButton icon={X} label={`${t("settings.translate.cancelDownload")}: ${name}`} onClick={onCancel} />
        ) : pack.state === "none" ? (
          <IconButton icon={ArrowDownToLine} label={`${t("settings.translate.downloadLanguage")}: ${name}`} onClick={onDownload} disabled={busy} />
        ) : (
          <IconButton icon={Trash2} label={`${t("settings.translate.removeLanguage")}: ${name}`} onClick={onRemove} disabled={busy} />
        )}
      </span>
    </li>
  );
}

function CustomModelRow({ model, locale, busy, onRemove }: { model: TranslateModel; locale: string; busy: boolean; onRemove: () => void }) {
  const { t } = useTranslation();
  const name = t("settings.translate.pairName", { source: languageName(model.source, locale), target: languageName(model.target, locale) });
  return (
    <li className="flex h-11 items-center gap-3 border-b text-sm last:border-b-0">
      <StateMark state="full" working={false} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate" title={model.id}>
        <span className="truncate">{languageName(model.source, locale)}</span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180" aria-label={t("settings.translate.into")} />
        <span className="truncate">{languageName(model.target, locale)}</span>
      </span>
      <span className="glass-chip rounded-full px-2 py-0.5 text-[11px] text-muted-foreground">{t("settings.translate.custom")}</span>
      {model.version ? <span className="rounded-md border bg-background/60 px-1.5 font-mono text-[11px] text-muted-foreground">v{model.version}</span> : null}
      <span className="w-16 text-end font-mono text-xs tabular-nums text-muted-foreground">{`${model.sizeMb} MB`}</span>
      <IconButton icon={Trash2} label={`${t("settings.translate.remove")}: ${name}`} onClick={onRemove} disabled={busy} />
    </li>
  );
}

function ManagerSkeleton() {
  return (
    <ul aria-busy className="animate-pulse">
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index} className="flex h-11 items-center gap-3 border-b last:border-b-0">
          <span className="size-5 rounded-full bg-muted" />
          <span className="h-4 flex-1 rounded-sm bg-muted" style={{ maxWidth: `${60 - index * 8}%` }} />
          <span className="h-4 w-14 rounded-sm bg-muted" />
        </li>
      ))}
    </ul>
  );
}

export function TranslateModelsManager() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const models = useTranslateModelsStore((state) => state.models);
  const directory = useTranslateModelsStore((state) => state.directory);
  const loading = useTranslateModelsStore((state) => state.loading);
  const loaded = useTranslateModelsStore((state) => state.loaded);
  const error = useTranslateModelsStore((state) => state.error);
  const downloadingLanguage = useTranslateModelsStore((state) => state.downloadingLanguage);
  const downloadProgress = useTranslateModelsStore((state) => state.downloadProgress);
  const refresh = useTranslateModelsStore((state) => state.refresh);
  const downloadLanguage = useTranslateModelsStore((state) => state.downloadLanguage);
  const cancelDownload = useTranslateModelsStore((state) => state.cancelDownload);
  const removeModel = useTranslateModelsStore((state) => state.removeModel);
  const removeLanguage = useTranslateModelsStore((state) => state.removeLanguage);
  const importModel = useTranslateModelsStore((state) => state.importModel);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!loaded && !loading) void refresh();
  }, [loaded, loading, refresh]);

  const download = async (code: string) => {
    try {
      await downloadLanguage(code);
      toast("success", t("settings.translate.downloaded"));
    } catch (caught) {
      const rpcError = toRpcError(caught);
      if (rpcError.code === "CANCELLED") toast("info", t("settings.translate.downloadCancelled"));
      else toast("error", describeError(t, rpcError));
    }
  };

  const pickAndImport = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "Argos Translate", extensions: ["argosmodel"] }] });
    if (typeof selected !== "string") return;
    setImporting(true);
    try {
      const id = await importModel(selected);
      const [source, target] = pairLanguages(id);
      toast("success", t("settings.translate.imported", { name: t("settings.translate.pairName", { source: languageName(source, locale), target: languageName(target, locale) }) }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setImporting(false);
    }
  };

  const remove = async (action: () => Promise<void>) => {
    try {
      await action();
      toast("success", t("settings.translate.removed"));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    }
  };

  const packs = useMemo(() => languagePacks(models), [models]);
  const customModels = useMemo(() => models.filter((model) => model.origin === "custom"), [models]);

  const { visiblePacks, visibleCustom } = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    const matches = (text: string) => !needle || text.toLocaleLowerCase(locale).includes(needle);
    return {
      visiblePacks: packs
        .filter((pack) => (filter === "all" || pack.state !== "none") && matches(`${languageName(pack.code, locale)} ${pack.code}`))
        .sort((a, b) => languageName(a.code, locale).localeCompare(languageName(b.code, locale), locale)),
      visibleCustom: customModels.filter((model) => matches(`${languageName(model.source, locale)} ${languageName(model.target, locale)} ${model.id}`)),
    };
  }, [packs, customModels, query, filter, locale]);

  const installedCount = packs.filter((pack) => pack.state !== "none").length;
  const percent = downloadProgress ? Math.round(downloadProgress.progress * 100) : 0;
  const busy = downloadingLanguage !== null || importing;
  const chip = (active: boolean) =>
    cn(
      "h-7 shrink-0 rounded-full border px-3 text-xs transition-colors duration-(--transition-fast)",
      active ? "glass-chip border-transparent font-medium text-foreground" : "border-(--glass-border) text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">{t("settings.translate.description")}</span>
        <span className="font-mono text-xs text-muted-foreground">{t("settings.translate.installed", { count: installedCount })}</span>
        <Button size="sm" icon={<Upload className="size-4" aria-hidden />} onClick={() => void pickAndImport()} loading={importing} disabled={downloadingLanguage !== null}>
          {t("settings.translate.import")}
        </Button>
        <IconButton icon={FolderOpen} label={t("settings.translate.openFolder")} onClick={() => directory && void revealPath(directory)} disabled={!directory} />
        <IconButton icon={RefreshCw} label={t("settings.translate.refresh")} onClick={() => void refresh()} disabled={loading} />
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.translate.pivotHint")}</p>
      <p className="text-xs text-muted-foreground">{t("settings.translate.importHint")}</p>
      {error ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => void refresh()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      <div className="sticky top-0 z-10 space-y-2 rounded-xl bg-card/80 py-1 backdrop-blur-sm">
        <span className="relative block">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.translate.search")} aria-label={t("settings.translate.search")} className="h-9 ps-9 text-sm" />
        </span>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button type="button" className={chip(filter === "all")} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            {t("settings.translate.filterAll")} · {packs.length}
          </button>
          <button type="button" className={chip(filter === "installed")} aria-pressed={filter === "installed"} onClick={() => setFilter("installed")}>
            {t("settings.translate.filterInstalled")} · {installedCount}
          </button>
        </div>
      </div>
      <div className="max-h-96 overflow-auto pe-1">
        {loading && models.length === 0 ? (
          <ManagerSkeleton />
        ) : visiblePacks.length === 0 && visibleCustom.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Search className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{t("settings.translate.noMatch")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.translate.noMatchHint")}</p>
            <Button size="sm" variant="secondary" onClick={() => { setQuery(""); setFilter("all"); }}>
              {t("settings.translate.clearFilters")}
            </Button>
          </div>
        ) : (
          <>
            {visiblePacks.length > 0 ? (
              <ul className="mb-3">
                {visiblePacks.map((pack) => (
                  <LanguageRow
                    key={pack.code}
                    pack={pack}
                    locale={locale}
                    working={downloadingLanguage === pack.code}
                    percent={percent}
                    busy={busy}
                    onDownload={() => void download(pack.code)}
                    onRemove={() => void remove(() => removeLanguage(pack.code))}
                    onCancel={cancelDownload}
                  />
                ))}
              </ul>
            ) : null}
            {visibleCustom.length > 0 ? (
              <div className="mb-3">
                <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t("settings.translate.customTitle")}
                  <span className="font-mono normal-case tracking-normal">{visibleCustom.length}</span>
                </p>
                <ul>
                  {visibleCustom.map((model) => (
                    <CustomModelRow key={model.id} model={model} locale={locale} busy={busy} onRemove={() => void remove(() => removeModel(model.id))} />
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
      {directory ? (
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={directory}>
          {directory}
        </p>
      ) : null}
    </div>
  );
}
