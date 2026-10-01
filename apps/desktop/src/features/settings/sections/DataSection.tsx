import { Clock, Database, FileClock, FileSignature, FolderCog, FolderSearch, History, KeyRound, Layers, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toRpcError } from "@/shared/rpc/client";
import { rememberRecentDocument } from "@/shared/rpc/files";
import { writeSession } from "@/shared/session/sessionStore";
import { formatBytes } from "@/shared/lib/format";
import { useHistoryStore } from "@/shared/store/historyStore";
import { useReadingPositionStore } from "@/shared/store/readingPositionStore";
import { useRecentStore } from "@/shared/store/recentStore";
import { useSignatureStore } from "@/shared/store/signatureStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useWatchStore } from "@/shared/store/watchStore";
import { readSavedChains, persistSavedChains } from "@/features/tools/batch/chain";
import { purgeChainSecrets } from "@/shared/rpc/chainSecrets";
import { describeError } from "@/shared/lib/errorMessage";
import type { SearchStatsResult } from "@/types";
import { SectionCard, SettingTile } from "../settingsControls";
import { CERTIFICATE_KEY, SEARCH_HISTORY_KEY, type SettingsSectionProps } from "../settingsShared";

export function DataSection({
  query,
  onEmptyChange,
  hasSession,
  setHasSession,
  certificatePath,
  setCertificatePath,
  searchHistoryCount,
  setSearchHistoryCount,
  chainCount,
  setChainCount,
  secretChainCount,
  setSecretChainCount,
  searchIndex,
  searchIndexBusy,
  setSearchIndexConfirmOpen,
  setResetOpen,
  setResetUserData,
  confirmClear,
}: SettingsSectionProps & {
  hasSession: boolean;
  setHasSession: (value: boolean) => void;
  certificatePath: string | null;
  setCertificatePath: (value: string | null) => void;
  searchHistoryCount: number;
  setSearchHistoryCount: (value: number) => void;
  chainCount: number;
  setChainCount: (value: number) => void;
  secretChainCount: number;
  setSecretChainCount: (value: number) => void;
  searchIndex: SearchStatsResult | null;
  searchIndexBusy: boolean;
  setSearchIndexConfirmOpen: (value: boolean) => void;
  setResetOpen: (value: boolean) => void;
  setResetUserData: (value: boolean) => void;
  confirmClear: (label: string, actionLabel: string, run: () => void) => () => void;
}) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const locale = useUiStore((state) => state.locale);
  const recentCount = useRecentStore((state) => state.items.length);
  const clearRecentFiles = useRecentStore((state) => state.clear);
  const clearRecent = () => {
    clearRecentFiles();
    useReadingPositionStore.getState().clear();
    void rememberRecentDocument("").catch(() => undefined);
  };
  const historyCount = useHistoryStore((state) => state.items.length);
  const clearHistory = useHistoryStore((state) => state.clear);
  const signatureCount = useSignatureStore((state) => state.items.length);
  const clearSignatures = useSignatureStore((state) => state.clear);
  const watchRuleCount = useWatchStore((state) => state.rules.length);
  const clearWatchRules = useWatchStore((state) => state.clearRules);

  const deleteSession = () => {
    writeSession(null);
    setHasSession(false);
    toast("success", t("settings.sessionDeleted"));
  };

  const forgetCertificate = () => {
    try {
      localStorage.removeItem(CERTIFICATE_KEY);
    } catch {
      return;
    }
    setCertificatePath(null);
    toast("success", t("settings.certificateForgotten"));
  };

  const clearSearchHistory = () => {
    try {
      localStorage.removeItem(SEARCH_HISTORY_KEY);
    } catch {
      return;
    }
    setSearchHistoryCount(0);
    toast("success", t("settings.searchHistoryCleared"));
  };

  const clearChains = async () => {
    await purgeChainSecrets().catch(() => undefined);
    persistSavedChains([]);
    setChainCount(0);
    setSecretChainCount(0);
    toast("success", t("settings.chainsCleared"));
  };

  const forgetChainSecrets = async () => {
    try {
      await purgeChainSecrets();
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
      return;
    }
    persistSavedChains(readSavedChains().map((chain) => ({ ...chain, storedSecrets: undefined })));
    setSecretChainCount(0);
    toast("success", t("settings.chainSecretsPurged"));
  };

  const removeSignatures = () => {
    clearSignatures();
    toast("success", t("settings.signaturesCleared"));
  };

  const removeWatchRules = () => {
    clearWatchRules();
    toast("success", t("settings.watchRulesCleared"));
  };

  return (
    <SectionCard id="data" query={query} onEmptyChange={onEmptyChange}>
      <div className="grid gap-2 py-3 sm:grid-cols-2">
        <SettingTile icon={Clock} label={t("settings.recentFiles")} value={t("settings.recentFilesCount", { count: recentCount })} actionLabel={t("settings.clearRecent")} onAction={confirmClear(t("settings.recentFiles"), t("settings.clearRecent"), clearRecent)} disabled={recentCount === 0} />
        <SettingTile icon={History} label={t("settings.history")} value={t("settings.historyCount", { count: historyCount })} actionLabel={t("settings.clearHistory")} onAction={confirmClear(t("settings.history"), t("settings.clearHistory"), clearHistory)} disabled={historyCount === 0} />
        <SettingTile icon={FolderSearch} label={t("settings.searchHistory")} value={t("settings.searchHistoryCount", { count: searchHistoryCount })} actionLabel={t("settings.clearRecent")} onAction={confirmClear(t("settings.searchHistory"), t("settings.clearRecent"), clearSearchHistory)} disabled={searchHistoryCount === 0} />
        <SettingTile icon={FileClock} label={t("settings.sessionSnapshot")} value={hasSession ? t("settings.sessionPresent") : t("settings.sessionNone")} actionLabel={t("settings.deleteSession")} onAction={confirmClear(t("settings.sessionSnapshot"), t("settings.deleteSession"), deleteSession)} disabled={!hasSession} />
        <SettingTile icon={ShieldCheck} label={t("settings.certificate")} value={certificatePath ?? t("settings.none")} actionLabel={t("settings.forgetCertificate")} onAction={forgetCertificate} disabled={!certificatePath} />
        <SettingTile icon={FileSignature} label={t("settings.signatures")} value={t("settings.signaturesCount", { count: signatureCount })} actionLabel={t("settings.clearRecent")} onAction={confirmClear(t("settings.signatures"), t("settings.clearRecent"), removeSignatures)} disabled={signatureCount === 0} />
        <SettingTile icon={FolderCog} label={t("settings.watchRules")} value={t("settings.watchRulesCount", { count: watchRuleCount })} actionLabel={t("settings.clearRecent")} onAction={confirmClear(t("settings.watchRules"), t("settings.clearRecent"), removeWatchRules)} disabled={watchRuleCount === 0} />
        <SettingTile icon={Layers} label={t("settings.chains")} value={t("settings.chainsCount", { count: chainCount })} actionLabel={t("settings.clearRecent")} onAction={confirmClear(t("settings.chains"), t("settings.clearRecent"), () => void clearChains())} disabled={chainCount === 0} />
        <SettingTile icon={KeyRound} label={t("settings.chainSecrets")} value={t("settings.chainSecretsCount", { total: secretChainCount })} actionLabel={t("settings.forgetChainSecrets")} onAction={confirmClear(t("settings.chainSecrets"), t("settings.forgetChainSecrets"), () => void forgetChainSecrets())} disabled={secretChainCount === 0} />
        <SettingTile
          icon={Database}
          label={t("settings.searchIndex")}
          value={searchIndex ? t("settings.searchIndexHint", { files: searchIndex.files, pages: searchIndex.pages, size: formatBytes(searchIndex.sizeBytes, locale) }) : "…"}
          actionLabel={t("settings.searchIndexClear")}
          onAction={() => setSearchIndexConfirmOpen(true)}
          disabled={searchIndexBusy || !searchIndex || searchIndex.files === 0}
        />
        <SettingTile icon={Trash2} label={t("settings.resetAll")} value={t("settings.resetAllHint")} actionLabel={t("settings.resetAllAction")} onAction={() => {
            setResetUserData(false);
            setResetOpen(true);
          }} danger />
      </div>
    </SectionCard>
  );
}
