import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "@/components/shared/Select";
import { Segmented } from "@/components/tool/form";
import { READING_FONT_MAX, READING_FONT_MIN, choosePageColors, useReadingStore } from "@/shared/store/readingStore";
import { PAGE_COLOR_SCHEMES, type PageColorScheme } from "@/shared/lib/pageColors";
import { useTtsVoicesStore } from "@/shared/store/ttsVoicesStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { ReadingTheme, ReadingWidth } from "@/types";
import { TranslateModelsManager } from "../TranslateModelsManager";
import { TtsVoicesManager } from "../TtsVoicesManager";
import { localeDisplayName } from "../voiceLocale";
import { RangeControl, SectionCard, SettingRow } from "../settingsControls";
import { useSystemVoices, type SettingsSectionProps } from "../settingsShared";

const READING_WIDTHS: ReadingWidth[] = ["narrow", "medium", "wide"];
const READING_THEMES: ReadingTheme[] = ["paper", "sepia", "dark"];
const NEURAL_PREFIX = "neural:";

export function ReadingSection({ query, onEmptyChange }: SettingsSectionProps) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const readingFontSize = useReadingStore((state) => state.fontSize);
  const readingWidth = useReadingStore((state) => state.width);
  const readingTheme = useReadingStore((state) => state.theme);
  const pageColors = useReadingStore((state) => state.pageColors);
  const readingRate = useReadingStore((state) => state.rate);
  const readingVoiceUri = useReadingStore((state) => state.voiceUri);
  const updateReading = useReadingStore((state) => state.update);
  const neuralVoices = useTtsVoicesStore((state) => state.voices);
  const systemVoices = useSystemVoices();

  const currentLanguage = locale.split("-")[0];
  const voiceOptions = useMemo(() => {
    const neural = neuralVoices
      .filter((voice) => voice.installed)
      .map((voice) => ({ value: `${NEURAL_PREFIX}${voice.id}`, label: `${t("viewer.readAloud.groupNeural")} · ${localeDisplayName(voice.locale || voice.language, locale)} · ${voice.name}` }));
    const system = [...systemVoices]
      .sort((a, b) => Number(b.lang.toLowerCase().startsWith(currentLanguage)) - Number(a.lang.toLowerCase().startsWith(currentLanguage)))
      .map((voice) => ({ value: voice.voiceURI, label: `${t("viewer.readAloud.groupSystem")} · ${voice.name} (${voice.lang})` }));
    return [{ value: "", label: t("viewer.readAloud.autoVoice") }, ...neural, ...system];
  }, [neuralVoices, systemVoices, currentLanguage, locale, t]);
  const voiceValue = voiceOptions.some((option) => option.value === (readingVoiceUri ?? "")) ? (readingVoiceUri ?? "") : "";

  return (
    <SectionCard id="reading" query={query} onEmptyChange={onEmptyChange}>
      <SettingRow label={t("settings.reading.fontSize")}>
        <RangeControl value={readingFontSize} min={READING_FONT_MIN} max={READING_FONT_MAX} display={`${readingFontSize} px`} onChange={(value) => updateReading({ fontSize: value })} ariaLabel={t("settings.reading.fontSize")} />
      </SettingRow>
      <SettingRow label={t("viewer.reading.width")}>
        <Segmented size="sm" value={readingWidth} options={READING_WIDTHS} labelOf={(option) => t(`viewer.reading.widths.${option}`)} onChange={(width) => updateReading({ width })} ariaLabel={t("viewer.reading.width")} />
      </SettingRow>
      <SettingRow label={t("viewer.reading.theme")}>
        <Segmented size="sm" value={readingTheme} options={READING_THEMES} labelOf={(option) => t(`viewer.reading.themes.${option}`)} onChange={(value) => updateReading({ theme: value })} ariaLabel={t("viewer.reading.theme")} />
      </SettingRow>
      <SettingRow label={t("viewer.pageDisplay.pageColors")} hint={t("settings.reading.pageColorsHint")}>
        <Select size="sm" value={pageColors} options={PAGE_COLOR_SCHEMES.map((scheme) => ({ value: scheme, label: t(`viewer.pageDisplay.colors.${scheme}`) }))} onChange={(value) => choosePageColors(value as PageColorScheme)} ariaLabel={t("viewer.pageDisplay.pageColors")} className="w-48" />
      </SettingRow>
      <SettingRow label={t("settings.reading.rate")}>
        <RangeControl value={readingRate} min={0.5} max={2} step={0.1} display={`${readingRate.toFixed(1)}×`} onChange={(value) => updateReading({ rate: Math.round(value * 10) / 10 })} ariaLabel={t("settings.reading.rate")} />
      </SettingRow>
      <SettingRow label={t("settings.reading.defaultVoice")} hint={t("settings.reading.defaultVoiceHint")}>
        <Select value={voiceValue} options={voiceOptions} onChange={(value) => updateReading({ voiceUri: value || null })} ariaLabel={t("settings.reading.defaultVoice")} className="w-80" />
      </SettingRow>
      <SettingRow label={t("settings.tts.title")} hint={t("settings.tts.sectionDescription")} block>
        <TtsVoicesManager />
      </SettingRow>
      <SettingRow label={t("settings.translate.title")} hint={t("settings.translate.sectionDescription")} block>
        <TranslateModelsManager />
      </SettingRow>
    </SectionCard>
  );
}
