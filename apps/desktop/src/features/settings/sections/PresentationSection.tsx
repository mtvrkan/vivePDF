import { RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Checkbox, Segmented } from "@/components/tool/form";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { RangeControl, SectionCard, SettingRow } from "../settingsControls";
import type { SettingsSectionProps } from "../settingsShared";

export function PresentationSection({ query, onEmptyChange }: SettingsSectionProps) {
  const { t } = useTranslation();
  const penColor = usePresentationStore((state) => state.penColor);
  const penWidth = usePresentationStore((state) => state.penWidth);
  const laserColor = usePresentationStore((state) => state.laserColor);
  const laserSize = usePresentationStore((state) => state.laserSize);
  const spotlightRadius = usePresentationStore((state) => state.spotlightRadius);
  const showClock = usePresentationStore((state) => state.showClock);
  const showTimer = usePresentationStore((state) => state.showTimer);
  const cursorAutoHide = usePresentationStore((state) => state.cursorAutoHide);
  const drawingsMode = usePresentationStore((state) => state.drawingsMode);
  const setPenColor = usePresentationStore((state) => state.setPenColor);
  const setPenWidth = usePresentationStore((state) => state.setPenWidth);
  const setLaserColor = usePresentationStore((state) => state.setLaserColor);
  const setLaserSize = usePresentationStore((state) => state.setLaserSize);
  const setSpotlightRadius = usePresentationStore((state) => state.setSpotlightRadius);
  const toggleClock = usePresentationStore((state) => state.toggleClock);
  const toggleTimerVisible = usePresentationStore((state) => state.toggleTimerVisible);
  const toggleCursorAutoHide = usePresentationStore((state) => state.toggleCursorAutoHide);
  const setDrawingsMode = usePresentationStore((state) => state.setDrawingsMode);
  const resetPresentation = usePresentationStore((state) => state.resetPrefs);

  return (
    <SectionCard
      id="presentation"
      query={query}
      onEmptyChange={onEmptyChange}
      actions={
        <Button size="sm" variant="ghost" icon={<RotateCw className="size-4" aria-hidden />} onClick={() => resetPresentation()}>
          {t("settings.presentation.reset")}
        </Button>
      }
    >
      <SettingRow label={t("settings.presentation.penColor")}>
        <ColorSwatch value={penColor} onChange={setPenColor} label={t("settings.presentation.penColor")} customLabel={t("settings.presentation.customColor")} />
        <RangeControl value={penWidth} min={1} max={12} display={`${penWidth} px`} onChange={setPenWidth} ariaLabel={t("settings.presentation.penWidth")} />
      </SettingRow>
      <SettingRow label={t("settings.presentation.laserColor")}>
        <ColorSwatch value={laserColor} onChange={setLaserColor} label={t("settings.presentation.laserColor")} customLabel={t("settings.presentation.customColor")} />
        <RangeControl value={laserSize} min={4} max={24} display={`${laserSize} px`} onChange={setLaserSize} ariaLabel={t("settings.presentation.laserSize")} />
      </SettingRow>
      <SettingRow label={t("settings.presentation.spotlightRadius")}>
        <RangeControl value={spotlightRadius} min={80} max={400} step={10} display={`${spotlightRadius} px`} onChange={setSpotlightRadius} ariaLabel={t("settings.presentation.spotlightRadius")} />
      </SettingRow>
      <SettingRow label={t("presentation.cursorAutoHide")}>
        <Checkbox label="" checked={cursorAutoHide} onChange={() => toggleCursorAutoHide()} />
      </SettingRow>
      <SettingRow label={t("presentation.toggleClock")}>
        <Checkbox label="" checked={showClock} onChange={() => toggleClock()} />
      </SettingRow>
      <SettingRow label={t("presentation.toggleTimer")}>
        <Checkbox label="" checked={showTimer} onChange={() => toggleTimerVisible()} />
      </SettingRow>
      <SettingRow label={t("settings.presentation.drawingsMode")} hint={t("settings.presentation.drawingsModeHint")}>
        <Segmented size="sm" value={drawingsMode} options={["temporary", "annotations"]} labelOf={(option) => t(`settings.presentation.drawings.${option}`)} onChange={setDrawingsMode} ariaLabel={t("settings.presentation.drawingsMode")} />
      </SettingRow>
    </SectionCard>
  );
}
