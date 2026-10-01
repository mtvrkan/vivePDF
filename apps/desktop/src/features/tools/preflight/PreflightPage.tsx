import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, FileDown, Printer, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { CheckPages } from "@/components/tool/CheckPages";
import { OptionCards, Section } from "@/components/tool/form";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { detailWithPages, saveCheckReport } from "@/shared/lib/checkReport";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { formatNumber } from "@/shared/lib/format";
import { basenameOf, joinPath, outputDirectoryFor, stemOf } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { checkPreflight } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { AccessStatus, PreflightCheck, PreflightProfile, PreflightReport, RpcError } from "@/types";
import { preflightDetailKey } from "./checkDetail";
import { PageFindings } from "./PageFindings";

const STATUS_ICON: Record<AccessStatus, typeof CheckCircle2> = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };
const STATUS_CLASS: Record<AccessStatus, string> = { pass: "text-success", warn: "text-warning", fail: "text-destructive" };
const FIX_ROUTES: Record<string, { route: string; labelKey: string }> = {
  pageSizes: { route: "/tools/edit?tab=resize", labelKey: "tools.preflight.fixResize" },
  transparency: { route: "/tools/edit?tab=flatten", labelKey: "tools.preflight.fixFlatten" },
  annotations: { route: "/tools/edit?tab=flatten", labelKey: "tools.preflight.fixFlatten" },
  forms: { route: "/tools/edit?tab=flatten", labelKey: "tools.preflight.fixFlatten" },
  encryption: { route: "/tools/security?tab=decrypt", labelKey: "tools.preflight.fixDecrypt" },
  blankPages: { route: "/pages", labelKey: "tools.preflight.fixPages" },
};
const MAX_LOW_ROWS = 40;
const PROFILES: readonly PreflightProfile[] = ["digital", "offset", "pdfx1a", "pdfx4"];
const PRESS_DPI = { target: 300, low: 150 };
const DPI_TARGETS: Record<PreflightProfile, { target: number; low: number }> = { digital: { target: 150, low: 100 }, offset: PRESS_DPI, pdfx1a: PRESS_DPI, pdfx4: PRESS_DPI };
const LIMITS = { inkLimit: 300, minSize: 6, safeZone: 3 };

export function PreflightPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const sourceState = useSourceDocument();
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<RpcError | null>(null);
  const checkRun = useRef(0);
  const [profile, setProfile] = useState<PreflightProfile>("digital");
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
      const result = await checkPreflight({ path: sourcePath, password: sourcePassword, profile });
      if (run === checkRun.current) setReport(result);
    } catch (caught) {
      if (run !== checkRun.current) return;
      setReport(null);
      setCheckError(toRpcError(caught));
    } finally {
      if (run === checkRun.current) setChecking(false);
    }
  }, [sourcePath, sourcePassword, profile]);

  useEffect(() => {
    checkRun.current += 1;
    setReport(null);
    setChecking(false);
    if (sourcePath && sourceInfo) void runCheck();
  }, [sourcePath, sourceInfo, runCheck]);

  const issues = report ? report.checks.filter((item) => item.status !== "pass") : [];
  const dpi = DPI_TARGETS[report?.profile ?? profile];
  const detailOf = (item: PreflightCheck) => t(preflightDetailKey(item), { count: item.count ?? 0, value: item.value ?? "", target: dpi.target, low: dpi.low, ...LIMITS });

  const exportReport = async () => {
    if (!report || !sourcePath) return;
    setExporting(true);
    try {
      const saved = await saveCheckReport(
        {
          heading: t("tools.checkReport.preflightHeading"),
          source: basenameOf(sourcePath),
          generatedAt: new Date().toLocaleString(locale),
          summary: [
            report.ready ? t("tools.preflight.ready") : t("tools.preflight.notReady"),
            t("tools.preflight.profileLine", { profile: t(`tools.preflight.profiles.${report.profile ?? profile}`) }),
            t("tools.preflight.summary", { pages: report.pageCount, images: report.images, version: report.pdfVersion }),
          ],
          columns: { check: t("tools.checkReport.columns.check"), status: t("tools.checkReport.columns.status"), detail: t("tools.checkReport.columns.detail") },
          statusLabels: { pass: t("tools.access.status.pass"), warn: t("tools.access.status.warn"), fail: t("tools.access.status.fail") },
          rows: report.checks.map((item) => ({
            id: item.id,
            status: item.status,
            title: t(`tools.preflight.checks.${item.id}.title`),
            detail: detailWithPages(detailOf(item), item.status !== "pass" ? item.pages : undefined, (list) => t("tools.checkReport.pageListLine", { pages: list })),
          })),
          extra:
            report.lowImages.length > 0 || report.unembeddedFonts.length > 0
              ? {
                  title: report.unembeddedFonts.length > 0 ? t("tools.preflight.detailsTitle") : t("tools.preflight.lowImagesTitle"),
                  lines: [
                    ...report.unembeddedFonts.map((font) => `${t("tools.preflight.checks.fonts.title")}: ${font}`),
                    ...report.lowImages.map((item) => `${t("viewer.comments.pageShort", { page: item.page })} · ${item.dpi} dpi · ${item.width}×${item.height} px`),
                  ],
                }
              : undefined,
        },
        joinPath(outputDirectoryFor(sourcePath), `${stemOf(sourcePath)}-${t("tools.checkReport.preflightFileSuffix")}.md`),
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
      title={t("nav.preflight")}
      icon={Printer}
      description={t("tools.preflight.description")}
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={checking} />
          <Section title={t("tools.preflight.profile")}>
            <OptionCards
              value={profile}
              onChange={setProfile}
              ariaLabel={t("tools.preflight.profile")}
              options={PROFILES.map((value) => ({ value, title: t(`tools.preflight.profiles.${value}`), description: t(`tools.preflight.profileHints.${value}`) }))}
            />
          </Section>
          <Section title={t("tools.preflight.report")}>
            {checking ? <p role="status" className="text-sm text-muted-foreground">{t("tools.preflight.checking")}</p> : null}
            {checkError ? <p role="alert" className="text-sm text-destructive">{describeError(t, checkError)}</p> : null}
            {!checking && !checkError && !report ? <p className="text-sm text-muted-foreground">{t("tools.preflight.idle.description")}</p> : null}
            {report ? (
              <ul className="rounded-lg border text-sm">
                {report.checks.map((item) => {
                  const Icon = STATUS_ICON[item.status];
                  const fix = item.status !== "pass" ? FIX_ROUTES[item.id] : undefined;
                  return (
                    <li key={item.id} className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", STATUS_CLASS[item.status])} aria-label={t(`tools.access.status.${item.status}`)} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{t(`tools.preflight.checks.${item.id}.title`)}</span>
                        <span className="text-xs text-muted-foreground">{detailOf(item)}</span>
                        {item.status !== "pass" && sourcePath && item.pages && item.pages.length > 0 ? <CheckPages path={sourcePath} pages={item.pages} /> : null}
                      </span>
                      {fix ? (
                        <Link to={fix.route} className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-secondary">
                          {t(fix.labelKey)}
                          <ArrowRight className="size-3.5" aria-hidden />
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {report && report.unembeddedFonts.length > 0 ? <p className="font-mono text-[11px] text-muted-foreground">{report.unembeddedFonts.join(", ")}</p> : null}
            {report ? (
              <div>
                <Button size="sm" variant="ghost" icon={<FileDown className="size-4" aria-hidden />} onClick={() => void exportReport()} loading={exporting}>
                  {t("tools.checkReport.export")}
                </Button>
              </div>
            ) : null}
          </Section>
          {report && sourcePath ? <PageFindings path={sourcePath} checks={report.checks} /> : null}
          {report && report.lowImages.length > 0 ? (
            <Section title={t("tools.preflight.lowImagesTitle")}>
              <ul className="max-h-64 overflow-auto rounded-lg border font-mono text-xs">
                {report.lowImages.slice(0, MAX_LOW_ROWS).map((item, index) => (
                  <li key={`${item.page}-${index}`} className="flex items-center gap-3 border-b px-3 py-1.5 last:border-b-0">
                    <span className="w-16 text-muted-foreground">{t("viewer.comments.pageShort", { page: item.page })}</span>
                    <span className={cn("w-16 tabular-nums", item.dpi < dpi.low ? "text-destructive" : "text-warning")}>{item.dpi} dpi</span>
                    <span className="text-muted-foreground">{item.width}×{item.height} px</span>
                  </li>
                ))}
              </ul>
              {report.lowImageCount > Math.min(report.lowImages.length, MAX_LOW_ROWS) ? <p className="text-xs text-muted-foreground">{t("tools.preflight.moreImages", { count: report.lowImageCount - Math.min(report.lowImages.length, MAX_LOW_ROWS) })}</p> : null}
            </Section>
          ) : null}
        </>
      }
      result={
        <aside aria-label={t("tools.resultPanel")} aria-busy={checking || undefined} className="glass-flat flex min-h-0 flex-col">
          {report ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              {report.ready ? <CheckCircle2 className="size-10 text-success" aria-hidden /> : <XCircle className="size-10 text-destructive" aria-hidden />}
              <p className="font-mono text-display font-medium tabular-nums">{formatNumber(issues.length, locale)}</p>
              <p className="text-sm font-semibold">{report.ready ? t("tools.preflight.ready") : t("tools.preflight.notReady")}</p>
              <p className="text-sm text-muted-foreground">{t("tools.preflight.summary", { pages: report.pageCount, images: report.images, version: report.pdfVersion })}</p>
            </div>
          ) : (
            <EmptyState icon={Printer} title={t("tools.preflight.idle.title")} description={t("tools.preflight.idle.description")} />
          )}
        </aside>
      }
    />
  );
}
