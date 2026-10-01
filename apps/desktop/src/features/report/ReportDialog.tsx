import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Dialog } from "@/components/shared/Dialog";
import { Button } from "@/components/shared/Button";
import { Checkbox } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { useReportStore, type DiagnosticsInfo } from "@/shared/store/reportStore";
import * as logger from "@/shared/lib/logger";

const GITHUB_ISSUE_URL = "https://github.com/mtvrkan/vivePDF/issues/new";
const BODY_LIMIT = 6000;
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

function diagnosticsBlock(diagnostics: DiagnosticsInfo, maxLogLines: number): string {
  const tail = diagnostics.logTail.split("\n").slice(-maxLogLines).join("\n");
  return [
    `OS: ${diagnostics.os} (${diagnostics.osVersion})`,
    `Arch: ${diagnostics.arch}`,
    `App version: ${diagnostics.appVersion}`,
    `Locale: ${diagnostics.locale ?? "n/a"}`,
    "Log tail:",
    tail,
  ].join("\n");
}

function buildBody(
  category: string,
  description: string,
  includeDiagnostics: boolean,
  diagnostics: DiagnosticsInfo | null,
  maxLogLines: number,
  limit: number | null,
): string {
  const parts = [`Category: ${category}`, "", description.trim() || "(no description)"];
  if (includeDiagnostics && diagnostics) {
    parts.push("", "---", diagnosticsBlock(diagnostics, maxLogLines));
  }
  const full = parts.join("\n");
  if (limit === null || full.length <= limit) return full;
  const withoutLog = parts.slice(0, -1).join("\n");
  const remaining = Math.max(0, limit - withoutLog.length - 20);
  const truncatedTail = diagnostics ? diagnosticsBlock(diagnostics, maxLogLines).slice(-remaining) : "";
  return `${withoutLog}\n${truncatedTail}`.slice(0, limit);
}

function buildTitle(category: string, description: string): string {
  const firstLine = description.trim().split("\n")[0] || "(no description)";
  const prefix = `[${category}] `;
  return `${prefix}${firstLine}`.slice(0, 80);
}

export function ReportDialog() {
  const { t } = useTranslation();
  const open = useReportStore((state) => state.open);
  const category = useReportStore((state) => state.category);
  const description = useReportStore((state) => state.description);
  const includeDiagnostics = useReportStore((state) => state.includeDiagnostics);
  const diagnostics = useReportStore((state) => state.diagnostics);
  const loadingDiagnostics = useReportStore((state) => state.loadingDiagnostics);
  const close = useReportStore((state) => state.close);
  const setCategory = useReportStore((state) => state.setCategory);
  const setDescription = useReportStore((state) => state.setDescription);
  const setIncludeDiagnostics = useReportStore((state) => state.setIncludeDiagnostics);

  const diagnosticsPreview = useMemo(
    () => (diagnostics ? diagnosticsBlock(diagnostics, 20) : ""),
    [diagnostics],
  );

  const handleOpenGithub = async () => {
    const title = buildTitle(category, description);
    const body = buildBody(category, description, includeDiagnostics, diagnostics, 200, BODY_LIMIT);
    const url = `${GITHUB_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${CATEGORY_LABELS_GITHUB[category]}`;
    logger.info("report", "action:openGithub");
    await openUrl(url);
  };

  const handleCopy = async () => {
    const body = buildBody(category, description, includeDiagnostics, diagnostics, 200, null);
    logger.info("report", "action:copyToClipboard");
    await navigator.clipboard.writeText(body);
  };

  const handleSaveToFile = async () => {
    logger.info("report", "action:saveToFile");
    const path = await save({ defaultPath: "vivepdf-report.txt", filters: [{ name: "Text", extensions: ["txt"] }] });
    if (!path) return;
    const contents = buildBody(category, description, includeDiagnostics, diagnostics, 200, null);
    await invoke("write_text_file", { path, contents });
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
        <div className="flex gap-2">
          {CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
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
          placeholder={t("report.descriptionPlaceholder")}
          className="field w-full rounded-lg px-3 py-2 text-sm outline-none"
        />
        <Checkbox label={t("report.includeDiagnostics")} checked={includeDiagnostics} onChange={setIncludeDiagnostics} />
        {includeDiagnostics ? (
          <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none text-muted-foreground">
              {t("report.diagnosticsPreview")}
            </summary>
            {loadingDiagnostics ? (
              <p className="mt-2 text-muted-foreground">{t("report.loadingDiagnostics")}</p>
            ) : (
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono">{diagnosticsPreview}</pre>
            )}
          </details>
        ) : null}
      </div>
    </Dialog>
  );
}
