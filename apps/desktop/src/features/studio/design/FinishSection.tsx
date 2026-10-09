import { useTranslation } from "react-i18next";
import { SliderField, SwitchField } from "@/components/tool/form";
import { STUDIO_FINISHES, STUDIO_FOILS, type StudioElement, type StudioFinish, type StudioFoil } from "@/types/studio";
import { defaultFinish, FINISH_DEPTH, FINISH_SOFTNESS, hasInkChoice } from "../model/finish";
import { patchSelected } from "./commands";
import { MixedHint, PanelSection, SelectField } from "./controls";
import { sharedValue } from "./multiEdit";

const NONE = "none";

export function FinishSection({ elements }: { elements: StudioElement[] }) {
  const { t } = useTranslation();
  const finishes = elements.map((element) => element.finish ?? null);
  const { value: shown, mixed } = sharedValue(finishes);
  const set = (next: StudioFinish | null, merge?: string) => patchSelected(() => ({ finish: next ?? undefined }), merge);
  const change = (patch: Partial<StudioFinish>, merge?: string) => (shown ? set({ ...shown, ...patch }, merge) : undefined);
  return (
    <PanelSection title={t("studio.finish.title")}>
      <SelectField
        label={t("studio.finish.type")}
        value={shown?.type ?? NONE}
        options={[NONE, ...STUDIO_FINISHES].map((value) => ({ value, label: t(`studio.finish.types.${value}`) }))}
        onChange={(value) => set(value === NONE ? null : defaultFinish(value as StudioFinish["type"], shown?.foil))}
      />
      {mixed ? <MixedHint /> : null}
      {shown ? (
        <div className="space-y-3" data-testid="studio-finish-fields">
          {shown.type === "foil" ? (
            <SelectField label={t("studio.finish.foil")} value={shown.foil} options={STUDIO_FOILS.map((value) => ({ value, label: t(`studio.finish.foils.${value}`) }))} onChange={(value) => change({ foil: value as StudioFoil })} />
          ) : null}
          {hasInkChoice(shown.type) ? <SwitchField label={t("studio.finish.blind")} hint={t("studio.finish.blindHint")} checked={shown.blind} onChange={(blind) => change({ blind })} /> : null}
          <SliderField label={t("studio.finish.depth")} value={shown.depth} min={FINISH_DEPTH.min} max={FINISH_DEPTH.max} step={0.1} format={(value) => `${value.toFixed(1)} pt`} onChange={(depth) => change({ depth }, "finish-depth")} />
          <SliderField label={t("studio.finish.softness")} value={shown.softness} min={FINISH_SOFTNESS.min} max={FINISH_SOFTNESS.max} step={0.1} format={(value) => `${value.toFixed(1)} pt`} onChange={(softness) => change({ softness }, "finish-softness")} />
          <SliderField label={t("studio.finish.light")} value={shown.angle} min={0} max={359} step={1} format={(value) => `${Math.round(value)}°`} onChange={(angle) => change({ angle }, "finish-angle")} />
          <p className="text-xs text-muted-foreground">{t("studio.finish.hint")}</p>
        </div>
      ) : null}
    </PanelSection>
  );
}
