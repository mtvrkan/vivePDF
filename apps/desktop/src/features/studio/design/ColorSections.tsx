import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import type { StudioElement } from "@/types/studio";
import { designColors, recolorDesign, recolorElement, uniqueElementColors } from "../model/colors";
import { PanelSection } from "./controls";
import { useStudioStore } from "./studioStore";

const MAX_DESIGN_COLOURS = 12;

function Swatches({ colors, onChange }: { colors: string[]; onChange: (index: number, from: string, to: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((color, index) => (
        <ColorSwatch key={index} value={color} label={t("studio.colors.swatch", { color })} customLabel={t("colorPicker.custom")} onChange={(next) => onChange(index, color, next)} />
      ))}
    </div>
  );
}

export function DesignColours() {
  const { t } = useTranslation();
  const colors = useStudioStore(useShallow((state) => (state.design ? designColors(state.design).slice(0, MAX_DESIGN_COLOURS) : [])));
  if (!colors.length) return null;
  return (
    <PanelSection title={t("studio.colors.design")}>
      <p className="text-xs text-muted-foreground">{t("studio.colors.designHint")}</p>
      <Swatches colors={colors} onChange={(index, from, to) => useStudioStore.getState().apply((design) => recolorDesign(design, from, to), { merge: `design-colour-${index}` })} />
    </PanelSection>
  );
}

export function ElementColours({ element }: { element: StudioElement }) {
  const { t } = useTranslation();
  const colors = uniqueElementColors(element);
  if (!colors.length) return null;
  const change = (index: number, from: string, to: string) =>
    useStudioStore.getState().applyToPage((page) => ({ ...page, elements: page.elements.map((item) => (item.id === element.id ? recolorElement(item, from, to) : item)) }), { merge: `element-colour-${element.id}-${index}` });
  return (
    <PanelSection title={t("studio.colors.element")}>
      <Swatches colors={colors} onChange={change} />
    </PanelSection>
  );
}
