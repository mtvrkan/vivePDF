import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router";
import { ArrowRight, CheckCircle2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Checkbox, Section } from "@/components/tool/form";
import { optionCount, reportIsClean, SANITIZE_OPTIONS } from "@/features/tools/security/securityForm";
import { describeError } from "@/shared/lib/errorMessage";
import { formatNumber } from "@/shared/lib/format";
import type { Locale, PrivacyReport, RedactPreset, RpcError, SanitizeOption } from "@/types";

const SHOWN_LINKS = 5;

export function PrivacySection({ report, scanning, scanError, canScan, onScan, options, onOptions, locale }: {
  report: PrivacyReport | null;
  scanning: boolean;
  scanError: RpcError | null;
  canScan: boolean;
  onScan: () => void;
  options: Record<SanitizeOption, boolean>;
  onOptions: Dispatch<SetStateAction<Record<SanitizeOption, boolean>>>;
  locale: Locale;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t("tools.security.privacy.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.security.privacy.hint")}</p>
      {scanning ? <p className="text-sm text-muted-foreground">{t("tools.security.privacy.scanning")}</p> : null}
      {scanError ? <p role="alert" className="text-sm text-destructive">{describeError(t, scanError)}</p> : null}
      {report && (report.signatures ?? 0) > 0 ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground/80">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t("tools.security.privacy.signedWarning")}
        </p>
      ) : null}
      {!scanning && !scanError && canScan ? (
        <Button variant={report ? "ghost" : "primary"} size={report ? "sm" : "md"} onClick={onScan}>
          {report ? t("tools.security.removeWatermark.finder.rescan") : t("tools.security.privacy.scan")}
        </Button>
      ) : null}
      {report && reportIsClean(report) ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {t("tools.security.privacy.clean")}
        </p>
      ) : null}
      {report && !reportIsClean(report) ? (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("tools.security.privacy.remove")}</p>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {SANITIZE_OPTIONS.map((option) => {
              const count = optionCount(report, option);
              const label = option === "resetForms" ? t("tools.security.privacy.resetForms") : t(`tools.security.privacy.items.${option}`);
              return (
                <Checkbox
                  key={option}
                  label={label}
                  value={formatNumber(count, locale)}
                  checked={options[option] && count > 0}
                  disabled={count === 0}
                  onChange={(checked) => onOptions((state) => ({ ...state, [option]: checked }))}
                />
              );
            })}
          </div>
          {Object.keys(report.metadata).length > 0 ? (
            <ul className="rounded-lg border text-sm">
              {Object.entries(report.metadata).map(([key, value]) => (
                <li key={key} className="flex gap-3 border-b px-3 py-1.5 last:border-b-0">
                  <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">{key}</span>
                  <span className="min-w-0 truncate" title={value}>{value}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {report.links.length > 0 ? (
            <ul className="rounded-lg border text-sm">
              {report.links.slice(0, SHOWN_LINKS).map((link, index) => (
                <li key={`${link.page}-${index}`} className="flex gap-3 border-b px-3 py-1.5 last:border-b-0">
                  <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{link.page}</span>
                  <span className="min-w-0 truncate" title={link.uri}>{link.uri}</span>
                </li>
              ))}
              {report.linkCount > SHOWN_LINKS ? (
                <li className="px-3 py-1.5 text-xs text-muted-foreground">{t("tools.security.privacy.linksMore", { count: report.linkCount - SHOWN_LINKS })}</li>
              ) : null}
            </ul>
          ) : null}
          {report.hiddenLayers > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("tools.security.privacy.items.layers")} · {t("tools.security.privacy.hidden", { count: report.hiddenLayers })}. {t("tools.security.privacy.layersHint")}
            </p>
          ) : null}
          {Object.keys(report.sensitive).length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{t("tools.security.privacy.sensitiveHint")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {(Object.entries(report.sensitive) as Array<[RedactPreset, number]>).map(([preset, count]) => (
                  <li key={preset} className="glass-chip flex h-7 items-center gap-1.5 rounded-md px-2 text-sm">
                    {t(`tools.edit.redact.presets.${preset}`)}
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatNumber(count, locale)}</span>
                  </li>
                ))}
              </ul>
              <Link to={`/tools/edit?tab=redact&presets=${Object.keys(report.sensitive).join(",")}`} className="flex w-fit items-center gap-1 text-sm text-primary hover:underline">
                {t("tools.security.privacy.redactLink")}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
