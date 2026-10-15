import { useEffect, useId, useMemo, type ClipboardEvent } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openExternal } from "@/shared/lib/openExternal";
import { useOfflineHint } from "@/shared/lib/offline";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Dialog } from "@/components/shared/Dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { basenameOf } from "@/shared/lib/paths";
import { isMac } from "@/shared/lib/platform";
import { saveSupportBundle } from "@/shared/lib/supportBundle";
import { clipboardImages, pickAttachments, reportImageFrom } from "./reportAttachments";
import { Checkbox } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useEngineStore } from "@/shared/store/engineStore";
import { useReportStore } from "@/shared/store/reportStore";
import { diagnosticsBlock, environmentLines } from "@/shared/lib/diagnosticsText";
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
  const attachments = useReportStore((state) => state.attachments);
  const images = useReportStore((state) => state.images);
  const addAttachments = useReportStore((state) => state.addAttachments);
  const removeAttachment = useReportStore((state) => state.removeAttachment);
  const addImage = useReportStore((state) => state.addImage);
  const removeImage = useReportStore((state) => state.removeImage);
  const attachmentsTitleId = useId();
  const hasAttachments = attachments.length > 0 || images.length > 0;
  const locale = `${i18n.language} (system ${navigator.language})`;

  const environment = useMemo(() => environmentLines(engine, tools), [engine, tools]);
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

  const offlineHint = useOfflineHint();

  const handleOpenGithub = async () => {
    const title = buildTitle(category, description);
    const bodies = LOG_LINE_STEPS.map((lines) => buildBody(category, description, diagnosticsText(lines)));
    const url = issueUrl(title, CATEGORY_LABELS_GITHUB[category], bodies);
    logger.info("report", "action:openGithub");
    try {
      await openExternal(url);
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

  const handleAddFiles = async () => {
    try {
      addAttachments(await pickAttachments(t("report.attachments.add")));
    } catch (error) {
      failed("addFiles", error);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = clipboardImages(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void (async () => {
      for (const file of files) {
        const image = await reportImageFrom(file, useReportStore.getState().images.length + 1);
        if (image) addImage(image);
        else toast("error", t("support.badImage"));
      }
    })();
  };

  const handleSavePackage = async () => {
    logger.info("report", "action:savePackage");
    await saveSupportBundle({ report: buildBody(category, description, null), attachments, images: images.map(({ name, base64 }) => ({ name, base64 })) });
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
          {hasAttachments ? (
            <Button variant="secondary" onClick={() => void handleSavePackage()}>
              {t("report.savePackage")}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void handleOpenGithub()} disabled={offlineHint !== undefined} title={offlineHint}>
            {t("report.openGithub")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" onPaste={handlePaste}>
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
        <section aria-labelledby={attachmentsTitleId} className="flex flex-col gap-2 rounded-md border px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <p id={attachmentsTitleId} className="text-sm font-medium">
              {t("report.attachments.title")}
            </p>
            <Button size="sm" variant="secondary" icon={<Paperclip className="size-4" aria-hidden />} onClick={() => void handleAddFiles()}>
              {t("report.attachments.add")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("report.attachments.hint", { keys: isMac ? "⌘V" : "Ctrl+V" })}</p>
          {hasAttachments ? (
            <ul className="flex flex-col gap-1" data-testid="report-attachments">
              {images.map((image) => (
                <li key={image.id} className="flex items-center gap-2 text-sm">
                  <img src={`data:${image.mime};base64,${image.base64}`} alt="" className="size-8 shrink-0 rounded border object-cover" />
                  <span className="min-w-0 flex-1 truncate">{image.name}</span>
                  <IconButton icon={X} label={t("report.attachments.remove", { name: image.name })} onClick={() => removeImage(image.id)} />
                </li>
              ))}
              {attachments.map((path) => (
                <li key={path} className="flex items-center gap-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={path}>
                    {basenameOf(path)}
                  </span>
                  <IconButton icon={X} label={t("report.attachments.remove", { name: basenameOf(path) })} onClick={() => removeAttachment(path)} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
