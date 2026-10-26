import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, CheckCircle2, FileDown, GraduationCap, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { Section } from "@/components/tool/form";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { detailWithPages, saveCheckReport } from "@/shared/lib/checkReport";
import { describeError } from "@/shared/lib/errorMessage";
import { formatNumber } from "@/shared/lib/format";
import { basenameOf, joinPath, outputDirectoryFor, stemOf } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { checkThesis } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { RpcError, ThesisCheckReport, ThesisCheckRules } from "@/types";
import { presetRules } from "./thesisCheckRules";
import { ThesisReport } from "./ThesisReport";
import { ThesisRulesForm } from "./ThesisRulesForm";
import { useThesisDetail } from "./useThesisDetail";

const RULES_DELAY_MS = 450;

export function ThesisCheckPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const pushToast = useToastStore((state) => state.push);
  const sourceState = useSourceDocument();
  const detailOf = useThesisDetail();
  const [rules, setRules] = useState<ThesisCheckRules>(() => presetRules("left40"));
  const [report, setReport] = useState<ThesisCheckReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<RpcError | null>(null);
  const [exporting, setExporting] = useState(false);
  const checkRun = useRef(0);

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
      const result = await checkThesis({ path: sourcePath, password: sourcePassword, ...rules });
      if (run === checkRun.current) setReport(result);
    } catch (caught) {
      if (run !== checkRun.current) return;
      setReport(null);
      setCheckError(toRpcError(caught));
    } finally {
      if (run === checkRun.current) setChecking(false);
    }
  }, [sourcePath, sourcePassword, rules]);

  useEffect(() => {
    checkRun.current += 1;
    setChecking(false);
    if (!sourcePath || !sourceInfo) {
      setReport(null);
      return;
    }
    const timer = window.setTimeout(() => void runCheck(), RULES_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [sourcePath, sourceInfo, runCheck]);

  const counted = report ? report.checks.filter((item) => item.status !== "skip") : [];
  const passed = counted.filter((item) => item.status === "pass").length;
  const noText = checkError?.data?.reason === "noText";

  const exportReport = async () => {
    if (!report || !sourcePath) return;
    setExporting(true);
    try {
      const saved = await saveCheckReport(
        {
          heading: t("tools.checkReport.thesisHeading"),
          source: basenameOf(sourcePath),
          generatedAt: new Date().toLocaleString(locale),
          summary: [report.ready ? t("tools.thesisCheck.ready") : t("tools.thesisCheck.notReady"), t("tools.thesisCheck.summary", { pages: report.pageCount, passed, total: counted.length })],
          columns: { check: t("tools.checkReport.columns.check"), status: t("tools.checkReport.columns.status"), detail: t("tools.checkReport.columns.detail") },
          statusLabels: { pass: t("tools.thesisCheck.status.pass"), warn: t("tools.thesisCheck.status.warn"), fail: t("tools.thesisCheck.status.fail") },
          rows: counted.map((item) => ({
            id: item.id,
            status: item.status === "skip" ? "pass" : item.status,
            title: t(`tools.thesisCheck.checks.${item.id}.title`),
            detail: detailWithPages(detailOf(item), item.status !== "pass" ? item.pages : undefined, (list) => t("tools.checkReport.pageListLine", { pages: list })),
          })),
        },
        joinPath(outputDirectoryFor(sourcePath), `${stemOf(sourcePath)}-${t("tools.checkReport.thesisFileSuffix")}.md`),
        t("tools.checkReport.fileLabel"),
      );
      if (saved) pushToast("success", t("tools.checkReport.saved", { name: basenameOf(saved) }));
    } catch (caught) {
      pushToast("error", describeError(t, toRpcError(caught)));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ToolLayout
      title={t("nav.thesisCheck")}
      icon={GraduationCap}
      description={t("tools.thesisCheck.description")}
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={checking} />
          <ThesisRulesForm rules={rules} onChange={setRules} />
          <Section title={t("tools.thesisCheck.report")}>
            {checking ? (
              <div role="status" aria-label={t("tools.thesisCheck.checking")} className="flex flex-col gap-2" data-thesis-loading>
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="h-10 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : null}
            {checkError ? (
              <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
                <p>{describeError(t, checkError)}</p>
                {noText ? (
                  <Link to="/tools/ocr" className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-secondary">
                    {t("tools.thesisCheck.openOcr")}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => void runCheck()}>
                    {t("common.retry")}
                  </Button>
                )}
              </div>
            ) : null}
            {!checking && !checkError && !report ? <p className="text-sm text-muted-foreground">{t("tools.thesisCheck.idle.description")}</p> : null}
            {report && !checking && sourcePath ? <ThesisReport path={sourcePath} checks={report.checks} /> : null}
            {report && !checking ? (
              <div>
                <Button size="sm" variant="ghost" icon={<FileDown className="size-4" aria-hidden />} onClick={() => void exportReport()} loading={exporting}>
                  {t("tools.checkReport.export")}
                </Button>
              </div>
            ) : null}
          </Section>
        </>
      }
      result={
        <aside aria-label={t("tools.resultPanel")} aria-busy={checking || undefined} className="glass-flat flex min-h-0 flex-col">
          {report ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" data-thesis-result>
              {report.ready ? <CheckCircle2 className="size-10 text-success" aria-hidden /> : <XCircle className="size-10 text-destructive" aria-hidden />}
              <p className="font-mono text-display font-medium tabular-nums">
                {formatNumber(passed, locale)}
                <span className="text-lg text-muted-foreground"> / {formatNumber(counted.length, locale)}</span>
              </p>
              <p className="text-sm font-semibold">{report.ready ? t("tools.thesisCheck.ready") : t("tools.thesisCheck.notReady")}</p>
              <p className="text-sm text-muted-foreground">{t("tools.thesisCheck.summary", { pages: report.pageCount, passed, total: counted.length })}</p>
            </div>
          ) : (
            <EmptyState icon={GraduationCap} title={t("tools.thesisCheck.idle.title")} description={t("tools.thesisCheck.idle.description")} />
          )}
        </aside>
      }
    />
  );
}
