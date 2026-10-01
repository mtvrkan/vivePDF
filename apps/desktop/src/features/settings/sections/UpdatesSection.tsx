import { ArrowDownToLine, RefreshCw, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Checkbox } from "@/components/tool/form";
import { useUiStore } from "@/shared/store/uiStore";
import { useUpdateStore } from "@/shared/store/updateStore";
import { Mono, SectionCard, SettingRow } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

export function UpdatesSection({ query, onEmptyChange, appVersion }: SettingsSectionProps & { appVersion: string }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const update = useUpdateStore();

  const updateTone =
    update.status === "upToDate"
      ? "success"
      : update.status === "available" || update.status === "ready"
        ? "primary"
        : update.status === "error"
          ? "destructive"
          : update.status === "unconfigured"
            ? "muted"
            : "warning";

  return (
    <SectionCard id="updates" query={query} onEmptyChange={onEmptyChange}>
      <SettingRow label={t("update.currentVersion")}>
        <Mono>{appVersion}</Mono>
      </SettingRow>
      <SettingRow
        label={t("update.status")}
        hint={t(`update.states.${update.status}`, { version: update.version, percent: Math.round(update.progress * 100) })}
        hintTone={updateTone}
        hintPulse={update.status === "idle" || update.status === "checking" || update.status === "downloading"}
        detail={
          update.status === "error" && update.error
            ? update.error
            : update.lastChecked
              ? t("update.lastChecked", { when: new Date(update.lastChecked).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })
              : undefined
        }
      >
        {update.status === "available" ? (
          <Button size="sm" variant="primary" icon={<ArrowDownToLine className="size-4" aria-hidden />} onClick={() => void update.install()}>
            {t("update.install")}
          </Button>
        ) : update.status === "ready" ? (
          <Button size="sm" variant="primary" icon={<RotateCw className="size-4" aria-hidden />} onClick={() => void update.restart()}>
            {t("update.restart")}
          </Button>
        ) : (
          <Button size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => void update.check(true)} loading={update.status === "checking" || update.status === "downloading"}>
            {t("update.check")}
          </Button>
        )}
      </SettingRow>
      {update.status === "downloading" ? (
        <div className="py-2">
          <div className="h-1 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuenow={Math.round(update.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${Math.round(update.progress * 100)}%` }} />
          </div>
        </div>
      ) : null}
      {update.notes && (update.status === "available" || update.status === "ready") ? (
        <div className="border-b py-3 last:border-b-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("update.notes")}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{update.notes}</p>
        </div>
      ) : null}
      <SettingRow label={t("update.autoCheck")} hint={t("update.autoCheckHint")}>
        <Checkbox label="" checked={update.autoCheck} onChange={update.setAutoCheck} />
      </SettingRow>
    </SectionCard>
  );
}
