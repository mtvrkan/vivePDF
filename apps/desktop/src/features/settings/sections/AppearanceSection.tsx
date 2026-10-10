import { useTranslation } from "react-i18next";
import { Select } from "@/components/shared/Select";
import { Checkbox, Segmented } from "@/components/tool/form";
import { LOCALES } from "@/app/locales";
import { UI_SCALES, usePreferencesStore, type UiScale } from "@/shared/store/preferencesStore";
import { useUiStore } from "@/shared/store/uiStore";
import { UI_ZOOMS, type UiZoom } from "@/shared/lib/uiZoom";
import { isMac } from "@/shared/lib/platform";
import type { Locale } from "@/types";
import { SectionCard, SettingRow, ThemeCards } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

export function AppearanceSection({ query, onEmptyChange }: SettingsSectionProps) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const theme = useUiStore((state) => state.theme);
  const setLocale = useUiStore((state) => state.setLocale);
  const setTheme = useUiStore((state) => state.setTheme);
  const uiScale = usePreferencesStore((state) => state.uiScale);
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const updatePreferences = usePreferencesStore((state) => state.update);

  return (
    <SectionCard id="appearance" query={query} onEmptyChange={onEmptyChange}>
      <SettingRow label={t("common.language")}>
        <Select value={locale} options={LOCALES.map((item) => ({ value: item.code, label: item.nativeName }))} onChange={(value) => setLocale(value as Locale)} ariaLabel={t("common.language")} className="w-52" />
      </SettingRow>
      <SettingRow label={t("common.theme")} hint={t(isMac ? "settings.appearance.themeMacHint" : "settings.appearance.themeHint")} block>
        <ThemeCards value={theme} onChange={setTheme} ariaLabel={t("common.theme")} />
      </SettingRow>
      <SettingRow label={t("settings.appearance.uiScale")} hint={t("settings.appearance.uiScaleHint")}>
        <Segmented size="sm" value={uiScale} options={UI_SCALES} labelOf={(option) => `${option}%`} onChange={(value: UiScale) => updatePreferences({ uiScale: value })} ariaLabel={t("settings.appearance.uiScale")} />
      </SettingRow>
      <SettingRow label={t("settings.appearance.uiZoom")} hint={t("settings.appearance.uiZoomHint")}>
        <Select
          size="sm"
          className="w-28"
          mono
          value={String(uiZoom)}
          options={UI_ZOOMS.map((option) => ({ value: String(option), label: `${Math.round(option * 100)}%` }))}
          onChange={(value) => updatePreferences({ uiZoom: Number(value) as UiZoom })}
          ariaLabel={t("settings.appearance.uiZoom")}
        />
      </SettingRow>
      <SettingRow label={t("settings.appearance.reduceMotion")} hint={t("settings.appearance.reduceMotionHint")}>
        <Checkbox label="" checked={reduceMotion} onChange={(value) => updatePreferences({ reduceMotion: value })} />
      </SettingRow>
    </SectionCard>
  );
}
