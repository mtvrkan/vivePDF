import { useNavigate } from "react-router";
import { Bug, ClipboardCopy, Keyboard, Lightbulb, ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toRpcError } from "@/shared/rpc/client";
import { useEngineStore } from "@/shared/store/engineStore";
import { useReportStore, type DiagnosticsInfo } from "@/shared/store/reportStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import { describeError } from "@/shared/lib/errorMessage";
import { ActionCard, SectionCard } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

export function FeedbackSection({ query, onEmptyChange, diagnosticsBusy, setDiagnosticsBusy }: SettingsSectionProps & {
  diagnosticsBusy: boolean;
  setDiagnosticsBusy: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToastStore((state) => state.push);
  const engine = useEngineStore((state) => state.info);
  const tools = useToolsStatusStore((state) => state.tools);

  const copyDiagnostics = async () => {
    setDiagnosticsBusy(true);
    try {
      const info = await invoke<DiagnosticsInfo>("diagnostics_info");
      const lines = [
        `vivePDF ${info.appVersion}`,
        `${info.os} ${info.osVersion} (${info.arch})`,
        `engine ${engine?.version ?? "—"} · PyMuPDF ${engine?.pymupdf ?? "—"} · Python ${engine?.python ?? "—"}`,
        `LibreOffice ${tools?.libreoffice ?? t("settings.notFound")}`,
        `OCR ${tools?.ocrLanguages.join(", ") || "—"}`,
        `log ${info.logPath}`,
      ];
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("success", t("settings.diagnosticsCopied"));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  return (
    <SectionCard id="feedback" query={query} onEmptyChange={onEmptyChange}>
      <div className="grid gap-2 py-3 sm:grid-cols-2">
        <ActionCard
          icon={Bug}
          title={t("settings.feedback.reportBug")}
          description={t("settings.feedback.reportBugHint")}
          actionLabel={t("settings.feedback.open")}
          onClick={() => useReportStore.getState().openDialog({ category: "bug" })}
        />
        <ActionCard
          icon={Lightbulb}
          title={t("settings.feedback.suggestFeature")}
          description={t("settings.feedback.suggestFeatureHint")}
          actionLabel={t("settings.feedback.open")}
          onClick={() => useReportStore.getState().openDialog({ category: "idea" })}
        />
        <ActionCard
          icon={Keyboard}
          title={t("about.tabs.shortcuts")}
          description={t("settings.feedback.shortcutsHint")}
          actionLabel={t("settings.feedback.open")}
          onClick={() => void navigate("/about?tab=shortcuts")}
        />
        <ActionCard
          icon={ClipboardCopy}
          title={t("settings.diagnostics")}
          description={t("settings.diagnosticsHint")}
          actionLabel={t("settings.copyDiagnostics")}
          onClick={() => void copyDiagnostics()}
          loading={diagnosticsBusy}
        />
        <ActionCard
          icon={ScrollText}
          title={t("settings.feedback.openLogFolder")}
          description={t("settings.feedback.openLogFolderHint")}
          actionLabel={t("settings.feedback.open")}
          onClick={() => void invoke("open_log_dir")}
        />
      </div>
    </SectionCard>
  );
}
