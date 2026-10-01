import { useCallback, useEffect, useRef, useState } from "react";
import { Accessibility, AlertTriangle, CheckCircle2, FileDown, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { CheckPages } from "@/components/tool/CheckPages";
import { Checkbox, Field, Section, TextInput } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { detailWithPages, saveCheckReport } from "@/shared/lib/checkReport";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { formatNumber } from "@/shared/lib/format";
import { basenameOf, joinPath, outputDirectoryFor, stemOf, suggestOutputPath } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { checkAccessibility, fixAccessibility } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { AccessReport, AccessStatus, RpcError } from "@/types";
import { FigurePreview, type FigurePreviewCache } from "./FigurePreview";

const STATUS_ICON: Record<AccessStatus, typeof CheckCircle2> = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };
const STATUS_CLASS: Record<AccessStatus, string> = { pass: "text-success", warn: "text-warning", fail: "text-destructive" };
const MAX_ALT_ROWS = 200;

export function AccessPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const sourceState = useSourceDocument();
  const operation = useOperation(fixAccessibility);
  const [report, setReport] = useState<AccessReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<RpcError | null>(null);
  const checkRun = useRef(0);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("");
  const [displayTitle, setDisplayTitle] = useState(true);
  const [altTexts, setAltTexts] = useState<Record<number, string>>({});
  const [tabOrder, setTabOrder] = useState(true);
  const [linkText, setLinkText] = useState(true);
  const [autoTag, setAutoTag] = useState(true);
  const [focusedFigure, setFocusedFigure] = useState<number | null>(null);
  const previewCache = useRef<FigurePreviewCache>(new Map());
  const [output, setOutput] = useState("");
  const [exporting, setExporting] = useState(false);
  const pushToast = useToastStore((state) => state.push);

  const source = sourceState.source;
  const sourcePath = source?.path ?? null;
  const sourcePassword = source?.password ?? undefined;
  const sourceInfo = source?.info;

  const runCheck = useCallback(async () => {
    if (!sourcePath) return;
    const run = ++checkRun.current;
    setChecking(true);
    setCheckError(null);
    try {
      const result = await checkAccessibility({ path: sourcePath, password: sourcePassword });
      if (run !== checkRun.current) return;
      setReport(result);
      setTitle(result.title);
      setLanguage(result.language ?? useUiStore.getState().locale);
      setDisplayTitle(true);
      setAltTexts(Object.fromEntries(result.figures.map((figure) => [figure.xref, figure.alt])));
      setTabOrder(true);
      setLinkText(true);
      setAutoTag(!result.tagged);
      setFocusedFigure(null);
    } catch (caught) {
      if (run !== checkRun.current) return;
      setReport(null);
      setCheckError(toRpcError(caught));
    } finally {
      if (run === checkRun.current) setChecking(false);
    }
  }, [sourcePath, sourcePassword]);

  const suffix = t("tools.access.suffix");
  useEffect(() => {
    if (sourcePath) setOutput(suggestOutputPath(sourcePath, suffix));
  }, [sourcePath, suffix]);

  useEffect(() => {
    checkRun.current += 1;
    setReport(null);
    setChecking(false);
    if (sourcePath && sourceInfo) void runCheck();
  }, [sourcePath, sourceInfo, runCheck]);

  const changedAlt = report ? Object.fromEntries(Object.entries(altTexts).filter(([xref, text]) => (report.figures.find((figure) => String(figure.xref) === xref)?.alt ?? "") !== text.trim() && text.trim())) : {};
  const tabOrderPages = report?.tabOrderPages ?? 0;
  const linksWithoutText = report?.linksWithoutText ?? 0;
  const applyTabOrder = tabOrder && tabOrderPages > 0;
  const applyLinkText = linkText && linksWithoutText > 0;
  const applyAutoTag = autoTag && !!report && !report.tagged;
  const hasChanges =
    !!report &&
    ((title.trim().length > 0 && title.trim() !== report.title) ||
      (language.trim() && language.trim() !== (report.language ?? "")) ||
      displayTitle !== report.displayDocTitle ||
      Object.keys(changedAlt).length > 0 ||
      applyTabOrder ||
      applyLinkText ||
      applyAutoTag);
  const ready = !!source?.info && !!report && output.length > 0 && hasChanges;

  const run = () => {
    if (!source || !report || !ready) return;
    void operation.run({
      path: source.path,
      password: source.password ?? undefined,
      output,
      title: title.trim() !== report.title ? title.trim() : undefined,
      language: language.trim() && language.trim() !== (report.language ?? "") ? language.trim() : undefined,
      displayDocTitle: displayTitle !== report.displayDocTitle ? displayTitle : undefined,
      altTexts: Object.fromEntries(Object.entries(changedAlt).map(([xref, text]) => [Number(xref), text.trim()])),
      tabOrder: applyTabOrder || undefined,
      linkText: applyLinkText || undefined,
      autoTag: applyAutoTag || undefined,
    });
  };

  const exportReport = async () => {
    if (!report || !source) return;
    setExporting(true);
    try {
      const saved = await saveCheckReport(
        {
          heading: t("tools.checkReport.accessHeading"),
          source: basenameOf(source.path),
          generatedAt: new Date().toLocaleString(locale),
          summary: [t("tools.checkReport.accessScore", { score: report.score }), t("tools.checkReport.pages", { count: report.pageCount })],
          columns: { check: t("tools.checkReport.columns.check"), status: t("tools.checkReport.columns.status"), detail: t("tools.checkReport.columns.detail") },
          statusLabels: { pass: t("tools.access.status.pass"), warn: t("tools.access.status.warn"), fail: t("tools.access.status.fail") },
          rows: report.checks.map((item) => ({
            id: item.id,
            status: item.status,
            title: t(`tools.access.checks.${item.id}.title`),
            detail: detailWithPages(
              t(`tools.access.checks.${item.id}.${item.status}`, { count: item.count ?? 0, value: item.value ?? "" }),
              item.status !== "pass" ? item.pages : undefined,
              (list) => t("tools.checkReport.pageListLine", { pages: list }),
            ),
          })),
          extra: report.unembeddedFonts.length > 0 ? { title: t("tools.access.checks.fonts.title"), lines: report.unembeddedFonts } : undefined,
        },
        joinPath(outputDirectoryFor(source.path), `${stemOf(source.path)}-${t("tools.checkReport.accessFileSuffix")}.md`),
        t("tools.checkReport.fileLabel"),
      );
      if (saved) pushToast("success", t("tools.checkReport.saved", { name: basenameOf(saved) }));
    } catch (caught) {
      pushToast("error", describeError(t, toRpcError(caught)));
    } finally {
      setExporting(false);
    }
  };

  const missingFigures = report ? report.figures.filter((figure) => !figure.alt).slice(0, MAX_ALT_ROWS) : [];

  return (
    <ToolLayout
      title={t("nav.access")}
      icon={Accessibility}
      description={t("tools.access.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t("tools.access.run")}
        </Button>
      }
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />
          <Section title={t("tools.access.report")}>
            {checking ? <p role="status" className="text-sm text-muted-foreground">{t("tools.access.checking")}</p> : null}
            {checkError ? <p role="alert" className="text-sm text-destructive">{describeError(t, checkError)}</p> : null}
            {!checking && !checkError && !report ? <p className="text-sm text-muted-foreground">{t("tools.access.idle.description")}</p> : null}
            {report ? (
              <>
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-display font-medium tabular-nums">{formatNumber(report.score, locale)}</span>
                  <span className="flex-1 text-sm text-muted-foreground">{t("tools.access.score")}</span>
                  <Button size="sm" variant="ghost" icon={<FileDown className="size-4" aria-hidden />} onClick={() => void exportReport()} loading={exporting}>
                    {t("tools.checkReport.export")}
                  </Button>
                </div>
                <ul className="rounded-lg border text-sm">
                  {report.checks.map((item) => {
                    const Icon = STATUS_ICON[item.status];
                    return (
                      <li key={item.id} className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0">
                        <Icon className={cn("mt-0.5 size-4 shrink-0", STATUS_CLASS[item.status])} aria-label={t(`tools.access.status.${item.status}`)} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium">{t(`tools.access.checks.${item.id}.title`)}</span>
                          <span className="text-xs text-muted-foreground">
                            {t(`tools.access.checks.${item.id}.${item.status}`, { count: item.count ?? 0, value: item.value ?? "" })}
                          </span>
                          {item.status !== "pass" && source && item.pages && item.pages.length > 0 ? <CheckPages path={source.path} pages={item.pages} /> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {report.unembeddedFonts.length > 0 ? (
                  <p className="font-mono text-[11px] text-muted-foreground">{report.unembeddedFonts.join(", ")}</p>
                ) : null}
              </>
            ) : null}
          </Section>
          {report ? (
            <Section title={t("tools.access.fixes")}>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("tools.access.title")}>
                  <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
                </Field>
                <Field label={t("tools.access.language")} hint={t("tools.access.languageHint")}>
                  <TextInput value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="tr-TR" className="font-mono" />
                </Field>
              </div>
              <Checkbox label={t("tools.access.displayTitle")} hint={t("tools.access.displayTitleHint")} checked={displayTitle} onChange={setDisplayTitle} />
              {tabOrderPages > 0 ? <Checkbox label={t("tools.access.fixTabOrder")} hint={t("tools.access.fixTabOrderHint", { count: tabOrderPages })} checked={tabOrder} onChange={setTabOrder} /> : null}
              {linksWithoutText > 0 ? <Checkbox label={t("tools.access.fixLinkText")} hint={t("tools.access.fixLinkTextHint", { count: linksWithoutText })} checked={linkText} onChange={setLinkText} /> : null}
              {missingFigures.length > 0 ? (
                <>
                  <p className="text-sm text-muted-foreground">{t("tools.access.altHint", { count: report.figuresWithoutAlt })}</p>
                  <ul className="flex flex-col gap-2">
                    {missingFigures.map((figure) => (
                      <li key={figure.xref} className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                          <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                            {figure.page ? t("viewer.comments.pageShort", { page: figure.page }) : `#${figure.xref}`}
                          </span>
                          <TextInput
                            value={altTexts[figure.xref] ?? ""}
                            onChange={(event) => setAltTexts((state) => ({ ...state, [figure.xref]: event.target.value }))}
                            onFocus={() => setFocusedFigure(figure.xref)}
                            placeholder={t("tools.access.altPlaceholder")}
                          />
                        </div>
                        {focusedFigure === figure.xref && source ? (
                          <div className="ps-19">
                            <FigurePreview path={source.path} password={source.password ?? undefined} xref={figure.xref} cache={previewCache.current} />
                          </div>
                        ) : null}
                      </li>
                    ))}
                    {report.figuresWithoutAlt > missingFigures.length ? (
                      <li className="text-xs text-muted-foreground">{t("common.andMore", { count: report.figuresWithoutAlt - missingFigures.length })}</li>
                    ) : null}
                  </ul>
                </>
              ) : null}
              {!report.tagged ? <Checkbox label={t("tools.access.autoTag.label")} hint={t("tools.access.autoTag.hint")} checked={autoTag} onChange={setAutoTag} /> : null}
              {!report.tagged ? <p className="text-xs text-muted-foreground">{t("tools.access.untaggedHint")}</p> : null}
              <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
            </Section>
          ) : null}
        </>
      }
      result={
        <ResultPanel
          sourcePath={source?.path}
          sourcePassword={source?.password ?? undefined}
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={operation.result ? formatNumber(operation.result.score, locale) : undefined}
          caption={operation.result ? t("tools.access.resultCaption", { changes: operation.result.changes }) : undefined}
          outputs={operation.result ? [operation.result.output] : []}
          idleIcon={Accessibility}
          idleTitle={t("tools.access.idle.title")}
          idleDescription={t("tools.access.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        >
          {operation.result?.autoTagged ? (
            <section className="flex flex-col gap-2 border-b px-4 py-3 text-sm" aria-labelledby="access-auto-tagged">
              <h3 id="access-auto-tagged" className="font-medium">{t("tools.access.autoTag.done")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("tools.access.autoTag.summary", {
                  headings: formatNumber(operation.result.autoTagged.headings, locale),
                  paragraphs: formatNumber(operation.result.autoTagged.paragraphs, locale),
                  figures: formatNumber(operation.result.autoTagged.figures, locale),
                })}
              </p>
              {(operation.result.figuresWithoutAlt ?? 0) > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">{t("tools.access.autoTag.altLeft", { count: operation.result.figuresWithoutAlt ?? 0 })}</p>
                  <Button size="sm" className="self-start" onClick={() => operation.result && void sourceState.setPath(operation.result.output)}>
                    {t("tools.access.autoTag.continue")}
                  </Button>
                </>
              ) : null}
            </section>
          ) : null}
        </ResultPanel>
      }
    />
  );
}
