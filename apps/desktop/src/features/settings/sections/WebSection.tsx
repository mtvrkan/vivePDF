import { useTranslation } from "react-i18next";
import { Select } from "@/components/shared/Select";
import { Checkbox, TextInput } from "@/components/tool/form";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useWebSearchStore } from "@/shared/store/webSearchStore";
import type { WebSearchEngine } from "@/shared/lib/webSearch";
import { Note, SectionCard, SettingRow } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

const WEB_SEARCH_ENGINES: WebSearchEngine[] = ["google", "bing", "duckduckgo", "startpage", "brave", "yandex", "custom"];

export function WebSection({ query, onEmptyChange }: SettingsSectionProps) {
  const { t } = useTranslation();
  const breachCheckOnline = usePreferencesStore((state) => state.breachCheckOnline);
  const updatePreferences = usePreferencesStore((state) => state.update);
  const webSearchEngine = useWebSearchStore((state) => state.engine);
  const webSearchCustomUrl = useWebSearchStore((state) => state.customUrl);
  const updateWebSearch = useWebSearchStore((state) => state.update);

  return (
    <SectionCard id="web" query={query} onEmptyChange={onEmptyChange}>
      <SettingRow label={t("settings.web.engine")}>
        <Select
          value={webSearchEngine}
          options={WEB_SEARCH_ENGINES.map((item) => ({ value: item, label: t(`settings.web.engines.${item}`) }))}
          onChange={(value) => updateWebSearch({ engine: value as WebSearchEngine })}
          ariaLabel={t("settings.web.engine")}
          className="w-52"
        />
      </SettingRow>
      {webSearchEngine === "custom" ? (
        <SettingRow label={t("settings.web.customUrl")} hint={t("settings.web.customUrlHint")} block>
          <TextInput value={webSearchCustomUrl} onChange={(event) => updateWebSearch({ customUrl: event.target.value })} placeholder="https://example.com/search?q={q}" aria-label={t("settings.web.customUrl")} className="font-mono text-sm" />
        </SettingRow>
      ) : null}
      <Note>
        <span className="font-medium text-foreground/80">{t("settings.web.lens")}</span> · {t("settings.web.lensHint")}
      </Note>
      <SettingRow label={t("settings.web.breachCheck")} hint={t("settings.web.breachCheckHint")}>
        <Checkbox label="" checked={breachCheckOnline} onChange={(value) => updatePreferences({ breachCheckOnline: value })} />
      </SettingRow>
    </SectionCard>
  );
}
