import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Select } from "@/components/shared/Select";
import { Checkbox } from "@/components/tool/form";
import { COMPRESS_PROFILES, usePreferencesStore } from "@/shared/store/preferencesStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import type { CompressPreset } from "@/types";
import { OfficeManager } from "../OfficeManager";
import { TessdataManager } from "../TessdataManager";
import { Mono, SectionCard, SettingRow } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

export function ToolsSection({ query, onEmptyChange }: SettingsSectionProps) {
  const { t } = useTranslation();
  const ocrLanguage = usePreferencesStore((state) => state.ocrLanguage);
  const compressProfile = usePreferencesStore((state) => state.compressProfile);
  const searchAutoIndex = usePreferencesStore((state) => state.searchAutoIndex);
  const updatePreferences = usePreferencesStore((state) => state.update);
  const tools = useToolsStatusStore((state) => state.tools);
  const toolsStatus = useToolsStatusStore((state) => state.status);
  const refreshTools = useToolsStatusStore((state) => state.refresh);

  return (
    <SectionCard id="tools" query={query} onEmptyChange={onEmptyChange}>
      <SettingRow label={t("settings.tools.ocrDefault")} hint={t("settings.tools.ocrDefaultHint")}>
        <Select
          value={ocrLanguage}
          options={[{ value: "", label: t("settings.tools.ocrAuto") }, ...(tools?.ocrLanguages ?? []).map((code) => ({ value: code, label: code }))]}
          onChange={(value) => updatePreferences({ ocrLanguage: value })}
          ariaLabel={t("settings.tools.ocrDefault")}
          className="w-52"
        />
      </SettingRow>
      <SettingRow label={t("settings.tools.compressProfile")} hint={t("settings.tools.compressProfileHint")}>
        <Select
          value={compressProfile}
          options={COMPRESS_PROFILES.map((item) => ({ value: item, label: t(`tools.compress.profiles.${item}.title`) }))}
          onChange={(value) => updatePreferences({ compressProfile: value as CompressPreset })}
          ariaLabel={t("settings.tools.compressProfile")}
          className="w-52"
        />
      </SettingRow>
      <SettingRow label={t("settings.tools.searchAutoIndex")} hint={t("settings.tools.searchAutoIndexHint")}>
        <Checkbox label="" checked={searchAutoIndex} onChange={(value) => updatePreferences({ searchAutoIndex: value })} />
      </SettingRow>
      <SettingRow label={t("settings.ocrLanguages")}>
        <Mono>{tools ? tools.ocrLanguages.join(", ") || "—" : "…"}</Mono>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => void refreshTools()} loading={toolsStatus === "loading"} aria-label={t("common.retry")} />
      </SettingRow>
      <SettingRow label={t("settings.tessdata.title")} hint={t("settings.tessdata.description")} block>
        <TessdataManager />
      </SettingRow>
      <SettingRow label={t("settings.office.title")} hint={t("settings.office.description")} block>
        <OfficeManager />
      </SettingRow>
    </SectionCard>
  );
}
