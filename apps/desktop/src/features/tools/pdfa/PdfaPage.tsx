import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Archive, CheckCircle2, Globe, RefreshCw, XCircle } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { OptionCards, Section } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { formatNumber } from "@/shared/lib/format";
import { suggestOutputPath } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { checkPdfa, convertPdfa } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { PdfaCheck, PdfaLevel, PdfaReport, RpcError } from "@/types";
import { pdfaCheckState, type PdfaCheckState } from "./pdfaCheckState";
import { pdfaComparison, pdfaDetailKey } from "./pdfaDetail";
import { useVeraPdfValidator } from "./useVeraPdfValidator";
import { VeraPdfCheck } from "./VeraPdfCheck";

const STATE_ICON: Record<PdfaCheckState, typeof CheckCircle2> = { pass: CheckCircle2, fixable: AlertTriangle, blocking: XCircle };
const STATE_CLASS: Record<PdfaCheckState, string> = { pass: "text-success", fixable: "text-warning", blocking: "text-destructive" };
const LEVELS: readonly PdfaLevel[] = ["1b", "2b", "2u", "3b"];
const VERAPDF_URL = "https://verapdf.org/software/";
const levelName = (level: PdfaLevel) => `PDF/A-${level}`;

export function PdfaPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const sourceState = useSourceDocument();
  const operation = useOperation(convertPdfa);
  const [report, setReport] = useState<PdfaReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<RpcError | null>(null);
  const checkRun = useRef(0);
  const pushToast = useToastStore((state) => state.push);
  const [output, setOutput] = useState("");
  const [level, setLevel] = useState<PdfaLevel>("2b");
  const vera = useVeraPdfValidator();

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
      const result = await checkPdfa({ path: sourcePath, password: sourcePassword, level });
      if (run === checkRun.current) setReport(result);
    } catch (caught) {
      if (run !== checkRun.current) return;
      setReport(null);
      setCheckError(toRpcError(caught));
    } finally {
      if (run === checkRun.current) setChecking(false);
    }
  }, [sourcePath, sourcePassword, level]);

  const resetOperation = operation.reset;
  useEffect(() => {
    checkRun.current += 1;
    setReport(null);
    setChecking(false);
    resetOperation();
    if (sourcePath && sourceInfo) void runCheck();
  }, [sourcePath, sourceInfo, runCheck, resetOperation]);

  const suffix = t("tools.pdfa.suffix");
  useEffect(() => {
    if (sourcePath) setOutput(suggestOutputPath(sourcePath, suffix));
  }, [sourcePath, suffix]);

  const converted = operation.result;
  useEffect(() => {
    if (converted?.fixed.includes("encryption")) pushToast("info", t("tools.pdfa.protectionRemoved"));
  }, [converted, pushToast, t]);

  const run = () => {
    if (!sourcePath || !output) return;
    void operation.run({ path: sourcePath, password: sourcePassword, output, level });
  };

  const detailOf = (item: PdfaCheck, checkedLevel: PdfaLevel) => {
    const state = pdfaCheckState(item);
    const detail = t(pdfaDetailKey(item, checkedLevel), { count: item.count ?? 0, value: item.value ?? "", level: levelName(checkedLevel) });
    return state === "fixable" ? `${detail} ${t("tools.pdfa.willFix")}` : detail;
  };

  const result = operation.result;
  const failing = report ? report.checks.filter((item) => item.status === "fail") : [];
  const headline = !report ? null : report.ready ? t("tools.pdfa.ready", { level: levelName(report.level) }) : report.convertible ? t("tools.pdfa.convertible") : t("tools.pdfa.blocked");
  const comparison = result && report ? pdfaComparison(report, result.report) : [];

  return (
    <ToolLayout
      title={t("nav.pdfa")}
      icon={Archive}
      description={t("tools.pdfa.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!report || !report.convertible || !output || checking}>
          {t("tools.pdfa.run")}
        </Button>
      }
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={checking || operation.running} />
          <Section title={t("tools.pdfa.level")}>
            <OptionCards
              value={level}
              onChange={setLevel}
              ariaLabel={t("tools.pdfa.level")}
              options={LEVELS.map((value) => ({ value, title: levelName(value), description: t(`tools.pdfa.levels.${value}`) }))}
            />
          </Section>
          <Section title={t("tools.pdfa.report")}>
            {checking ? (
              <div role="status" aria-label={t("tools.pdfa.checking")} className="space-y-2">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="h-9 animate-pulse rounded-md bg-secondary/70" />
                ))}
              </div>
            ) : null}
            {checkError ? (
              <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive">
                <span>{describeError(t, checkError)}</span>
                <Button size="sm" variant="ghost" onClick={() => void runCheck()}>
                  {t("tools.pdfa.retry")}
                </Button>
              </div>
            ) : null}
            {!checking && !checkError && !report ? <p className="text-sm text-muted-foreground">{t("tools.pdfa.idle.description")}</p> : null}
            {report && !checking ? (
              <>
                <p className="text-sm">
                  <span className="font-medium">{headline}</span>{" "}
                  <span className="text-muted-foreground">{report.claimed ? t("tools.pdfa.claimed", { value: report.claimed }) : t("tools.pdfa.notClaimed")}</span>
                </p>
                <ul className="rounded-lg border text-sm">
                  {report.checks.map((item) => {
                    const state = pdfaCheckState(item);
                    const Icon = STATE_ICON[state];
                    return (
                      <li key={item.id} className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0">
                        <Icon className={cn("mt-0.5 size-4 shrink-0", STATE_CLASS[state])} aria-label={t(`tools.pdfa.states.${state}`)} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium">{t(`tools.pdfa.checks.${item.id}.title`)}</span>
                          <span className="text-xs text-muted-foreground">{detailOf(item, report.level)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">{t("tools.pdfa.scope", { level: levelName(report.level) })}</p>
              </>
            ) : null}
          </Section>
          {sourcePath ? (
            <Section title={t("tools.pdfa.vera.title")}>
              {!vera.info ? <div role="status" aria-label={t("tools.pdfa.vera.looking")} className="h-8 animate-pulse rounded-md bg-secondary/70" /> : null}
              {vera.info?.available ? (
                <>
                  <p className="text-xs text-muted-foreground">{vera.info.version ? t("tools.pdfa.vera.installed", { version: vera.info.version }) : t("tools.pdfa.vera.installedUnknown")}</p>
                  <VeraPdfCheck key={`${sourcePath}|${level}`} path={sourcePath} level={level} label={t("tools.pdfa.vera.checkSource", { level: levelName(level) })} />
                </>
              ) : null}
              {vera.info && !vera.info.available ? (
                <>
                  <p className="text-sm text-muted-foreground">{t("tools.pdfa.vera.missing")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" icon={<Globe className="size-4" aria-hidden />} onClick={() => void openUrl(VERAPDF_URL)}>
                      verapdf.org
                    </Button>
                    <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" aria-hidden />} onClick={vera.refresh}>
                      {t("tools.pdfa.vera.lookAgain")}
                    </Button>
                  </div>
                </>
              ) : null}
            </Section>
          ) : null}
          <Section>
            <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
          </Section>
        </>
      }
      result={
        <ResultPanel
          sourcePath={source?.path}
          sourcePassword={sourcePassword}
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? formatNumber(result.fixed.length, locale) : report ? formatNumber(failing.length, locale) : undefined}
          caption={result ? (result.report.ready ? t("tools.pdfa.done", { level: levelName(result.report.level) }) : t("tools.pdfa.doneWithIssues")) : undefined}
          outputs={result ? [result.output] : []}
          idleIcon={Archive}
          idleTitle={t("tools.pdfa.idle.title")}
          idleDescription={t("tools.pdfa.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        >
          {result && comparison.length > 0 ? (
            <div className="border-b px-4 py-3">
              <h3 className="mb-2 text-sm font-medium">{t("tools.pdfa.comparison.title")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1 pe-2 text-start font-normal">{t("tools.pdfa.comparison.check")}</th>
                      <th scope="col" className="px-2 py-1 text-center font-normal">{t("tools.pdfa.comparison.before")}</th>
                      <th scope="col" className="ps-2 py-1 text-center font-normal">{t("tools.pdfa.comparison.after")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((row) => {
                      const BeforeIcon = STATE_ICON[row.before];
                      const AfterIcon = row.after === "pass" ? CheckCircle2 : XCircle;
                      return (
                        <tr key={row.id} className="border-t">
                          <th scope="row" className="py-1.5 pe-2 text-start font-normal">{t(`tools.pdfa.checks.${row.id}.title`)}</th>
                          <td className="px-2 py-1.5 text-center">
                            <BeforeIcon className={cn("inline size-4", STATE_CLASS[row.before])} aria-label={t(`tools.pdfa.states.${row.before}`)} />
                          </td>
                          <td className="ps-2 py-1.5 text-center">
                            <AfterIcon className={cn("inline size-4", row.after === "pass" ? "text-success" : "text-destructive")} aria-label={t(`tools.pdfa.comparison.${row.after}`)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {result && vera.info?.available ? (
            <div className="border-b px-4 py-3">
              <VeraPdfCheck key={`${result.output}|${result.report.level}`} path={result.output} level={result.report.level} label={t("tools.pdfa.vera.checkCopy")} />
            </div>
          ) : null}
        </ResultPanel>
      }
    />
  );
}
