import { useTranslation } from "react-i18next";
import { Select } from "@/components/shared/Select";
import { Checkbox, Segmented } from "@/components/tool/form";
import { toRpcError } from "@/shared/rpc/client";
import { setAutostart } from "@/shared/rpc/tray";
import { KEEP_IN_TRAY_MODES, RECENT_LIMITS, usePreferencesStore, type KeepInTray, type RecentLimit } from "@/shared/store/preferencesStore";
import { useToastStore } from "@/shared/store/toastStore";
import { describeError } from "@/shared/lib/errorMessage";
import { isMac } from "@/shared/lib/platform";
import type { AutostartStatus } from "@/types";
import { SectionCard, SettingRow } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

export function GeneralSection({ query, onEmptyChange, autostart, setAutostartState, autostartBusy, setAutostartBusy }: SettingsSectionProps & {
  autostart: AutostartStatus | null;
  setAutostartState: (value: AutostartStatus) => void;
  autostartBusy: boolean;
  setAutostartBusy: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const recentLimit = usePreferencesStore((state) => state.recentLimit);
  const confirmClose = usePreferencesStore((state) => state.confirmClose);
  const keepInTray = usePreferencesStore((state) => state.keepInTray);
  const successToasts = usePreferencesStore((state) => state.successToasts);
  const restoreSession = usePreferencesStore((state) => state.restoreSession);
  const rememberRecent = usePreferencesStore((state) => state.rememberRecent);
  const keepHistory = usePreferencesStore((state) => state.keepHistory);
  const keepBackups = usePreferencesStore((state) => state.keepBackups);
  const updatePreferences = usePreferencesStore((state) => state.update);

  const toggleAutostart = async (enabled: boolean) => {
    setAutostartBusy(true);
    try {
      const next = await setAutostart(enabled);
      setAutostartState(next);
      toast("success", t(next.enabled ? "settings.general.autostartOn" : "settings.general.autostartOff"));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setAutostartBusy(false);
    }
  };

  const changeKeepInTray = (value: KeepInTray) => {
    updatePreferences({ keepInTray: value });
    if (value === "off" && autostart?.enabled) void toggleAutostart(false);
  };

  return (
    <SectionCard id="general" query={query} onEmptyChange={onEmptyChange}>
      <SettingRow label={t("settings.general.restoreSession")} hint={t("settings.general.restoreSessionHint")}>
        <Checkbox label="" checked={restoreSession} onChange={(value) => updatePreferences({ restoreSession: value })} />
      </SettingRow>
      <SettingRow label={t("settings.general.rememberRecent")} hint={t("settings.general.rememberRecentHint")}>
        <Checkbox label="" checked={rememberRecent} onChange={(value) => updatePreferences({ rememberRecent: value })} />
      </SettingRow>
      <SettingRow label={t("settings.general.keepHistory")} hint={t("settings.general.keepHistoryHint")}>
        <Checkbox label="" checked={keepHistory} onChange={(value) => updatePreferences({ keepHistory: value })} />
      </SettingRow>
      <SettingRow label={t("settings.general.recentLimit")} hint={t("settings.general.recentLimitHint")}>
        <Segmented size="sm" value={recentLimit} options={RECENT_LIMITS} labelOf={(option) => String(option)} onChange={(value: RecentLimit) => updatePreferences({ recentLimit: value })} ariaLabel={t("settings.general.recentLimit")} />
      </SettingRow>
      <SettingRow label={t("settings.general.confirmClose")} hint={t("settings.general.confirmCloseHint")}>
        <Checkbox label="" checked={confirmClose} onChange={(value) => updatePreferences({ confirmClose: value })} />
      </SettingRow>
      <SettingRow label={t("settings.general.keepInTray")} hint={autostart && !autostart.trayByDefault ? t("settings.general.keepInTrayLinuxHint") : t(isMac ? "settings.general.keepInTrayMacHint" : "settings.general.keepInTrayHint")}>
        <Select
          value={keepInTray}
          options={KEEP_IN_TRAY_MODES.map((item) => ({ value: item, label: t(`settings.general.keepInTrayModes.${item}`) }))}
          onChange={(value) => changeKeepInTray(value as KeepInTray)}
          ariaLabel={t("settings.general.keepInTray")}
          className="w-52"
        />
      </SettingRow>
      {autostart?.supported ? (
        <SettingRow label={t("settings.general.autostart")} hint={t(isMac ? "settings.general.autostartMacHint" : "settings.general.autostartHint")}>
          <Checkbox label="" checked={autostart.enabled} disabled={autostartBusy || (keepInTray === "off" && !autostart.enabled)} onChange={(checked) => void toggleAutostart(checked)} />
        </SettingRow>
      ) : null}
      <SettingRow label={t("settings.general.successToasts")} hint={t("settings.general.successToastsHint")}>
        <Checkbox label="" checked={successToasts} onChange={(value) => updatePreferences({ successToasts: value })} />
      </SettingRow>
      <SettingRow label={t("settings.general.keepBackups")} hint={t("settings.general.keepBackupsHint")}>
        <Checkbox label="" checked={keepBackups} onChange={(value) => updatePreferences({ keepBackups: value })} />
      </SettingRow>
    </SectionCard>
  );
}
