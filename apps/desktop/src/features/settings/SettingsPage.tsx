import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Search, SearchX, Settings, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { isInAppPath } from "./returnPath";
import { cn } from "@/shared/lib/cn";
import { toRpcError } from "@/shared/rpc/client";
import { fileAssociationEnabled, sendToEnabled, setShellIntegration, shellIntegrationEnabled, shellIntegrationSupported } from "@/shared/rpc/files";
import { readSession } from "@/shared/session/sessionStore";
import { searchClearAll, searchStats } from "@/shared/rpc/operations";
import { autostartStatus, setAutostart } from "@/shared/rpc/tray";
import { useToastStore } from "@/shared/store/toastStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import { useAppVersion } from "@/shared/hooks/useAppVersion";
import { readSavedChains } from "@/features/tools/batch/chain";
import { purgeChainSecrets } from "@/shared/rpc/chainSecrets";
import { Checkbox } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { shellMenuEntries } from "@/shared/lib/shellMenu";
import type { AutostartStatus, SearchStatsResult } from "@/types";
import { keysKeptOnReset, resetStoredSettings } from "@/shared/store/storedSettings";
import { CERTIFICATE_KEY, SEARCH_HISTORY_KEY, SECTION_GROUPS, SECTION_ICONS, SECTION_IDS, countChainsWithSecrets, isSectionId, readStored, readStoredCount, type SectionId } from "./settingsShared";
import { AppearanceSection } from "./sections/AppearanceSection";
import { GeneralSection } from "./sections/GeneralSection";
import { FilesSection } from "./sections/FilesSection";
import { WebSection } from "./sections/WebSection";
import { ViewerSection } from "./sections/ViewerSection";
import { ReadingSection } from "./sections/ReadingSection";
import { PresentationSection } from "./sections/PresentationSection";
import { ToolsSection } from "./sections/ToolsSection";
import { UpdatesSection } from "./sections/UpdatesSection";
import { SystemSection } from "./sections/SystemSection";
import { DataSection } from "./sections/DataSection";
import { FeedbackSection } from "./sections/FeedbackSection";

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToastStore((state) => state.push);
  const [searchParams, setSearchParams] = useSearchParams();
  const toolsStatus = useToolsStatusStore((state) => state.status);
  const refreshTools = useToolsStatusStore((state) => state.refresh);
  const appVersion = useAppVersion();
  const [query, setQuery] = useState("");
  const [emptySections, setEmptySections] = useState<ReadonlySet<SectionId>>(() => new Set());
  const requestedSection = searchParams.get("section");
  const activeSection: SectionId = isSectionId(requestedSection) ? requestedSection : "appearance";
  const requestedReturn = searchParams.get("from");
  const returnTo = requestedReturn && isInAppPath(requestedReturn) ? requestedReturn : null;
  const searching = query.trim() !== "";
  const [hasSession, setHasSession] = useState(() => readSession() !== null);
  const [certificatePath, setCertificatePath] = useState(() => readStored(CERTIFICATE_KEY) || null);
  const [searchHistoryCount, setSearchHistoryCount] = useState(() => readStoredCount(SEARCH_HISTORY_KEY));
  const [chainCount, setChainCount] = useState(() => readSavedChains().length);
  const [secretChainCount, setSecretChainCount] = useState(() => countChainsWithSecrets());
  const [shellSupported, setShellSupported] = useState(false);
  const [shellEnabled, setShellEnabled] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const [associationEnabled, setAssociationEnabled] = useState(false);
  const [associationBusy, setAssociationBusy] = useState(false);
  const [sendToEnabledState, setSendToEnabledState] = useState(false);
  const [sendToBusy, setSendToBusy] = useState(false);
  const [searchIndex, setSearchIndex] = useState<SearchStatsResult | null>(null);
  const [searchIndexBusy, setSearchIndexBusy] = useState(false);
  const [searchIndexConfirmOpen, setSearchIndexConfirmOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingClear, setPendingClear] = useState<{ label: string; actionLabel: string; run: () => void } | null>(null);
  const confirmClear = (label: string, actionLabel: string, run: () => void) => () => setPendingClear({ label, actionLabel, run });
  const [resetUserData, setResetUserData] = useState(false);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [autostart, setAutostartState] = useState<AutostartStatus | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void shellIntegrationSupported().then((supported) => {
      setShellSupported(supported);
      if (!supported) return;
      void shellIntegrationEnabled().then((enabled) => {
        setShellEnabled(enabled);
        if (enabled) void setShellIntegration(true, t("app.name"), shellMenuEntries(t)).catch(() => undefined);
      });
      void fileAssociationEnabled().then(setAssociationEnabled);
      void sendToEnabled(t("app.name")).then(setSendToEnabledState);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (toolsStatus === "idle") void refreshTools();
  }, [toolsStatus, refreshTools]);

  useEffect(() => {
    void searchStats().then(setSearchIndex).catch(() => undefined);
  }, []);

  useEffect(() => {
    void autostartStatus().then(setAutostartState).catch(() => undefined);
  }, []);

  const onEmptyChange = useCallback((id: SectionId, empty: boolean) => {
    setEmptySections((current) => {
      if (current.has(id) === empty) return current;
      const next = new Set(current);
      if (empty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectSection = (id: SectionId) => {
    setQuery("");
    setSearchParams(returnTo ? { section: id, from: returnTo } : { section: id }, { replace: true });
    paneRef.current?.scrollTo({ top: 0 });
  };

  const clearSearchIndex = async () => {
    setSearchIndexConfirmOpen(false);
    setSearchIndexBusy(true);
    try {
      await searchClearAll();
      setSearchIndex(await searchStats());
      toast("success", t("settings.searchIndexCleared"));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setSearchIndexBusy(false);
    }
  };

  const resetAllSettings = async () => {
    if (resetUserData) await purgeChainSecrets().catch(() => undefined);
    if (!resetStoredSettings(keysKeptOnReset(resetUserData))) return;
    if (autostart?.enabled) void setAutostart(false).then(setAutostartState).catch(() => undefined);
    setResetOpen(false);
    setResetUserData(false);
    setCertificatePath(readStored(CERTIFICATE_KEY) || null);
    setSearchHistoryCount(readStoredCount(SEARCH_HISTORY_KEY));
    setChainCount(readSavedChains().length);
    setSecretChainCount(countChainsWithSecrets());
    setHasSession(readSession() !== null);
    toast("success", t("settings.resetAllDone"));
  };

  const sectionVisible = (id: SectionId) => id !== "system" || shellSupported;
  const sectionShown = (id: SectionId) => sectionVisible(id) && (searching || id === activeSection);
  const noMatch = searching && SECTION_IDS.filter(sectionVisible).every((id) => emptySections.has(id));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("nav.settings")}
        description={t("settings.description")}
        icon={Settings}
        eyebrow={t("app.name")}
        actions={
          <div className="flex items-center gap-2">
            {returnTo ? (
              <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => void navigate(returnTo)}>
                {t("settings.backToViewer")}
              </Button>
            ) : null}
          <label className="glass-flat relative flex h-9 w-72 max-w-full items-center rounded-lg border ps-9">
            <Search className="pointer-events-none absolute start-3 size-4 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.searchPlaceholder")}
              aria-label={t("settings.searchPlaceholder")}
              className="h-full w-full bg-transparent pe-9 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label={t("settings.clearSearch")} className="absolute end-2 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </label>
          </div>
        }
      />
      <div ref={paneRef} className="scrollbar-stable min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-8 pt-6 md:grid-cols-[15rem_minmax(0,1fr)] md:px-6">
          <nav aria-label={t("nav.settings")} className="md:sticky md:top-0 md:self-start">
            {SECTION_GROUPS.map((group) => {
              const sections = group.sections.filter(sectionVisible);
              if (sections.length === 0) return null;
              return (
                <div key={group.id} className="mb-5 last:mb-0">
                  <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t(`settings.groups.${group.id}`)}</p>
                  <ul className="space-y-0.5">
                    {sections.map((id) => {
                      const Icon = SECTION_ICONS[id];
                      const active = !searching && id === activeSection;
                      const dimmed = searching && emptySections.has(id);
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            aria-current={active ? "page" : undefined}
                            onClick={() => selectSection(id)}
                            className={cn(
                              "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm transition-[color,background-color,opacity] duration-(--transition-fast)",
                              active ? "menubar-active font-medium text-foreground" : "text-foreground/80 hover:bg-(--hover-bg) hover:text-foreground",
                              dimmed && "opacity-45",
                            )}
                          >
                            <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-start">{t(`settings.sections.${id}.title`)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>
          <div className="min-w-0 space-y-4">
            {noMatch ? (
              <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center">
                <span className="tone-tile flex size-11 items-center justify-center rounded-xl">
                  <SearchX className="size-5" aria-hidden />
                </span>
                <p className="text-sm text-muted-foreground">{t("settings.noMatch")}</p>
                <Button size="sm" variant="ghost" onClick={() => setQuery("")}>
                  {t("settings.clearSearch")}
                </Button>
              </div>
            ) : null}

            {sectionShown("appearance") ? (
            <AppearanceSection query={query} onEmptyChange={onEmptyChange} />
            ) : null}

            {sectionShown("general") ? (
            <GeneralSection query={query} onEmptyChange={onEmptyChange} autostart={autostart} setAutostartState={setAutostartState} autostartBusy={autostartBusy} setAutostartBusy={setAutostartBusy} />
            ) : null}

            {sectionShown("files") ? (
            <FilesSection query={query} onEmptyChange={onEmptyChange} />
            ) : null}

            {sectionShown("web") ? (
            <WebSection query={query} onEmptyChange={onEmptyChange} />
            ) : null}

            {sectionShown("viewer") ? (
            <ViewerSection query={query} onEmptyChange={onEmptyChange} />
            ) : null}

            {sectionShown("reading") ? (
            <ReadingSection query={query} onEmptyChange={onEmptyChange} />
            ) : null}

            {sectionShown("presentation") ? (
            <PresentationSection query={query} onEmptyChange={onEmptyChange} />
            ) : null}

            {sectionShown("tools") ? (
            <ToolsSection query={query} onEmptyChange={onEmptyChange} />
            ) : null}

            {sectionShown("updates") ? (
            <UpdatesSection query={query} onEmptyChange={onEmptyChange} appVersion={appVersion} />
            ) : null}

            {sectionShown("system") ? (
              <SystemSection
                query={query}
                onEmptyChange={onEmptyChange}
                shellEnabled={shellEnabled}
                setShellEnabled={setShellEnabled}
                shellBusy={shellBusy}
                setShellBusy={setShellBusy}
                associationEnabled={associationEnabled}
                setAssociationEnabled={setAssociationEnabled}
                associationBusy={associationBusy}
                setAssociationBusy={setAssociationBusy}
                sendToEnabledState={sendToEnabledState}
                setSendToEnabledState={setSendToEnabledState}
                sendToBusy={sendToBusy}
                setSendToBusy={setSendToBusy}
              />
            ) : null}

            {sectionShown("data") ? (
            <DataSection
              query={query}
              onEmptyChange={onEmptyChange}
              hasSession={hasSession}
              setHasSession={setHasSession}
              certificatePath={certificatePath}
              setCertificatePath={setCertificatePath}
              searchHistoryCount={searchHistoryCount}
              setSearchHistoryCount={setSearchHistoryCount}
              chainCount={chainCount}
              setChainCount={setChainCount}
              secretChainCount={secretChainCount}
              setSecretChainCount={setSecretChainCount}
              searchIndex={searchIndex}
              searchIndexBusy={searchIndexBusy}
              setSearchIndexConfirmOpen={setSearchIndexConfirmOpen}
              setResetOpen={setResetOpen}
              setResetUserData={setResetUserData}
              confirmClear={confirmClear}
            />
            ) : null}

            {sectionShown("feedback") ? (
            <FeedbackSection query={query} onEmptyChange={onEmptyChange} diagnosticsBusy={diagnosticsBusy} setDiagnosticsBusy={setDiagnosticsBusy} />
            ) : null}
          </div>
        </div>
      </div>
      <Dialog
        open={searchIndexConfirmOpen}
        title={t("settings.searchIndex")}
        onClose={() => setSearchIndexConfirmOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSearchIndexConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void clearSearchIndex()}>
              {t("settings.searchIndexClear")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t("settings.searchIndexConfirm")}</p>
      </Dialog>
      <Dialog
        open={pendingClear !== null}
        title={pendingClear?.label ?? ""}
        onClose={() => setPendingClear(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingClear(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                pendingClear?.run();
                setPendingClear(null);
              }}
            >
              {pendingClear?.actionLabel}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t("settings.clearConfirm", { name: pendingClear?.label ?? "" })}</p>
      </Dialog>
      <Dialog
        open={resetOpen}
        title={t("settings.resetAll")}
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void resetAllSettings()}>
              {t("settings.resetAllAction")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("settings.resetAllConfirm")}</p>
          <Checkbox label={t("settings.resetAllUserData")} hint={t("settings.resetAllUserDataHint")} checked={resetUserData} onChange={setResetUserData} />
        </div>
      </Dialog>
    </div>
  );
}
