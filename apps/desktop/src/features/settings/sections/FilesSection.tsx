import { FolderCog } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { Select } from "@/components/shared/Select";
import { Segmented, TextInput } from "@/components/tool/form";
import { AFTER_OPERATIONS, usePreferencesStore, type AfterOperation } from "@/shared/store/preferencesStore";
import { useUiStore } from "@/shared/store/uiStore";
import { DEFAULT_OUTPUT_PATTERN, OUTPUT_PATTERN_TOKENS, outputFileName, patternIsValid } from "@/shared/lib/naming";
import { isMac } from "@/shared/lib/platform";
import { SectionCard, SettingRow } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

const OUTPUT_MODE_OPTIONS = ["beside", "folder"] as const;

export function FilesSection({ query, onEmptyChange }: SettingsSectionProps) {
  const { t } = useTranslation();
  const outputPattern = useUiStore((state) => state.outputPattern);
  const setOutputPattern = useUiStore((state) => state.setOutputPattern);
  const outputPatternValid = patternIsValid(outputPattern);
  const outputMode = usePreferencesStore((state) => state.outputMode);
  const outputFolder = usePreferencesStore((state) => state.outputFolder);
  const afterOperation = usePreferencesStore((state) => state.afterOperation);
  const updatePreferences = usePreferencesStore((state) => state.update);

  const pickOutputFolder = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    updatePreferences({ outputFolder: selected, outputMode: "folder" });
  };

  return (
    <SectionCard id="files" query={query} onEmptyChange={onEmptyChange}>
      <SettingRow label={t("settings.files.outputMode")} hint={t("settings.files.outputModeHint")}>
        <Segmented
          size="sm"
          value={outputMode}
          options={OUTPUT_MODE_OPTIONS}
          labelOf={(option) => t(`settings.files.outputModes.${option}`)}
          onChange={(value) => {
            if (value === "folder" && !outputFolder) void pickOutputFolder();
            else updatePreferences({ outputMode: value });
          }}
          ariaLabel={t("settings.files.outputMode")}
        />
      </SettingRow>
      {outputMode === "folder" ? (
        <SettingRow label={t("settings.files.outputFolder")} hint={outputFolder || t("settings.files.outputFolderNone")}>
          <Button size="sm" icon={<FolderCog className="size-4" aria-hidden />} onClick={() => void pickOutputFolder()}>
            {t("settings.files.chooseFolder")}
          </Button>
        </SettingRow>
      ) : null}
      <SettingRow label={t("settings.files.afterOperation")} hint={t("settings.files.afterOperationHint")}>
        <Select
          value={afterOperation}
          options={AFTER_OPERATIONS.map((item) => ({ value: item, label: t(`settings.files.afterOperations.${isMac && item === "reveal" ? "revealMac" : item}`) }))}
          onChange={(value) => updatePreferences({ afterOperation: value as AfterOperation })}
          ariaLabel={t("settings.files.afterOperation")}
          className="w-52"
        />
      </SettingRow>
      <SettingRow
        label={t("settings.outputPattern")}
        hint={outputPatternValid ? t("settings.outputExample", { example: `${outputFileName(t("settings.outputExampleName"), "ocr", outputPattern)}.pdf` }) : t("settings.outputPatternInvalid")}
        hintTone={outputPatternValid ? undefined : "destructive"}
      >
        <TextInput value={outputPattern} onChange={(event) => setOutputPattern(event.target.value)} aria-label={t("settings.outputPattern")} aria-invalid={outputPatternValid ? undefined : true} className="w-64 font-mono" />
        <Button variant="ghost" size="sm" onClick={() => setOutputPattern(DEFAULT_OUTPUT_PATTERN)} disabled={outputPattern === DEFAULT_OUTPUT_PATTERN}>
          {t("settings.reset")}
        </Button>
      </SettingRow>
      <SettingRow label={t("settings.outputTokens")} hint={t("settings.outputPatternHint")}>
        {OUTPUT_PATTERN_TOKENS.map((token) => (
          <code key={token} className="glass-chip rounded-md px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">{`{${token}}`}</code>
        ))}
      </SettingRow>
    </SectionCard>
  );
}
