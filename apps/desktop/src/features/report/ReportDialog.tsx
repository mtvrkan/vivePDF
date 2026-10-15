import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Dialog } from "@/components/shared/Dialog";
import { Button } from "@/components/shared/Button";
import { Checkbox } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useEngineStore } from "@/shared/store/engineStore";
import { useReportStore, type DiagnosticsInfo } from "@/shared/store/reportStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import * as logger from "@/shared/lib/logger";

const GITHUB_ISSUE_URL = "https://github.com/mtvrkan/vivePDF/issues/new";
const GITHUB_URL_LIMIT = 7500;
const LOG_LINES = 200;
const LOG_LINE_STEPS = [LOG_LINES, 100, 50, 20, 0];
const CATEGORIES = ["crash", "bug", "idea"] as const;
const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  crash: "report.category.crash",
  bug: "report.category.bug",
  idea: "report.category.idea",
};
const CATEGORY_LABELS_GITHUB: Record<(typeof CATEGORIES)[number], string> = {
  crash: "bug",
  bug: "bug",
  idea: "enhancement",
};

function diagnosticsBlock(diagnostics: DiagnosticsInfo, environment: string[], maxLogLines: number, locale: string): string {
  const lines = [`OS: ${diagnostics.osVersion}`, `Arch: ${diagnostics.arch}`, `App version: ${diagnostics.appVersion}`, ...environment, `Locale: ${locale}`];
  if (maxLogLines === 0) return lines.join("\n");
  const tail = diagnostics.logTail.split("\n").slice(-maxLogLines).join("\n");
  return [...lines, "Log tail:", tail].join("\n");
}

function buildBody(category: string, description: string, diagnosticsText: string | null): string {
  const parts = [`Category: ${category}`, "", description.trim() || "(no description)"];
  if (diagnosticsText) parts.push("", "---", diagnosticsText);
  return parts.join("\n");
}

function buildTitle(category: string, description: string): string {
  const firstLine = description.trim().split("\n")[0] || "(no description)";
  const prefix = `[${category}] `;
  return [...`${prefix}${firstLine}`].slice(0, 80).join("");
}

function issueUrl(title: string, label: string, bodies: string[]): string {
  const base = `${GITHUB_ISSUE_URL}?title=${encodeURIComponent(title)}&labels=${label}&body=`;
  const fits = (body: string) => base.length + encodeURIComponent(body).length <= GITHUB_URL_LIMIT;
  let body = bodies.find(fits) ?? bodies.at(-1) ?? "";
  while (body && !fits(body)) {
    const characters = [...body];
    body = characters.slice(0, Math.floor(characters.length * 0.9)).join("");
  }
  return `${base}${encodeURIComponent(body)}`;
}

export function ReportDialog() {
  const { t, i18n } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const open = useReportStore((state) => state.open);
  const category = useReportStore((state) => state.category);
  const description = useReportStore((state) => state.description);
  const includeDiagnostics = useReportStore((state) => state.includeDiagnostics);
  const diagnostics = useReportStore((state) => state.diagnostics);
  const loadingDiagnostics = useReportStore((state) => state.loadingDiagnostics);
  const diagnosticsFailed = useReportStore((state) => state.diagnosticsFailed);
  const loadDiagnostics = useReportStore((state) => state.loadDiagnostics);
  const engine = useEngineStore((state) => state.info);
  const tools = useToolsStatusStore((state) => state.tools);
  const close = useReportStore((state) => state.close);
  const setCategory = useReportStore((state) => state.setCategory);
  const setDescription = useReportStore((state) => state.setDescription);
  const setIncludeDiagnostics = useReportStore((state) => state.setIncludeDiagnostics);
  const locale = `${i18n.language} (system ${navigator.language})`;

  const environment = useMemo(
    () => [`Engine: ${engine?.version ?? "-"} (PyMuPDF ${engine?.pymupdf ?? "-"}, Python ${engine?.python ?? "-"})`, `LibreOffice: ${tools ? (tools.libreoffice ?? "not installed") : "-"}`, `OCR languages: ${tools?.ocrLanguages.join(", ") || "-"}`],
    [engine, tools],
  );
  const diagnosticsText = (logLines: number) => (includeDiagnostics && diagnostics ? diagnosticsBlock(diagnostics, environment, logLines, locale) : null);
  const diagnosticsPreview = useMemo(() => (diagnostics ? diagnosticsBlock(diagnostics, environment, LOG_LINES, locale) : ""), [diagnostics, environment, locale]);

  useEffect(() => {
    if (open && includeDiagnostics) void loadDiagnostics();
  }, [open, includeDiagnostics, loadDiagnostics]);

  const fullBody = () => buildBody(category, description, diagnosticsText(LOG_LINES));

  const failed = (action: string, error: unknown) => {
    logger.error("report", `${action} failed: ${String(error)}`);
    toast("error", describeError(t, toRpcError(error)));
  };

  const handleOpenGithub = async () => {
    const title = buildTitle(category, description);
    const bodies = LOG_LINE_STEPS.map((lines) => buildBody(category, description, diagnosticsText(lines)));
    const url = issueUrl(title, CATEGORY_LABELS_GITHUB[category], bodies);
    logger.info("report", "action:openGithub");
    try {
      await openUrl(url);
    } catch (error) {
      failed("openGithub", error);
    }
  };

  const handleCopy = async () => {
    logger.info("report", "action:copyToClipboard");
    try {
      await navigator.clipboard.writeText(fullBody());
      toast("success", t("report.copied"));
    } catch (error) {
      failed("copyToClipboard", error);
    }
  };

  const handleSaveToFile = async () => {
    logger.info("report", "action:saveToFile");
    try {
      const path = await save({ defaultPath: "vivepdf-report.txt", filters: [{ name: "Text", extensions: ["txt"] }] });
      if (!path) return;
      await invoke("write_text_file", { path, contents: fullBody() });
      toast("success", t("report.saved"));
    } catch (error) {
      failed("saveToFile", error);
    }
  };

  return (
    <Dialog
      open={open}
      title={t("report.title")}
      onClose={close}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => void handleCopy()}>
            {t("report.copyToClipboard")}
          </Button>
          <Button variant="secondary" onClick={() => void handleSaveToFile()}>
            {t("report.saveToFile")}
          </Button>
          <Button variant="primary" onClick={() => void handleOpenGithub()}>
            {t("report.openGithub")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2" role="group" aria-label={t("report.typeLabel")}>
          {CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === category}
              onClick={() => setCategory(value)}
              className={cn(
                "h-8 flex-1 rounded-lg border px-3 text-sm",
                value === category
                  ? "border-ring bg-secondary text-foreground"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {t(CATEGORY_LABELS[value])}
            </button>
          ))}
        </div>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          aria-label={t("report.descriptionLabel")}
          placeholder={t("report.descriptionPlaceholder")}
          className="field w-full rounded-lg px-3 py-2 text-sm outline-none"
        />
        <Checkbox label={t("report.includeDiagnostics")} checked={includeDiagnostics} onChange={setIncludeDiagnostics} />
        {includeDiagnostics ? (
          <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none text-muted-foreground">
              {t("report.diagnosticsPreview")}
            </summary>
            {diagnostics ? (
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono">{diagnosticsPreview}</pre>
            ) : diagnosticsFailed && !loadingDiagnostics ? (
              <div className="mt-2 flex items-center justify-between gap-3" role="alert">
                <span className="text-destructive">{t("report.diagnosticsFailed")}</span>
                <Button size="sm" variant="secondary" onClick={() => void loadDiagnostics()}>
                  {t("common.retry")}
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-muted-foreground">{t("report.loadingDiagnostics")}</p>
            )}
          </details>
        ) : null}
      </div>
    </Dialog>
  );
}
