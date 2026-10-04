import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { StudioElement } from "@/types/studio";
import { designColors, recolorDesign, recolorElement, uniqueElementColors } from "../model/colors";
import { PanelSection, StudioColorSwatch } from "./controls";
import { useStudioStore } from "./studioStore";

const MAX_DESIGN_COLOURS = 12;

function Swatches({ colors, onChange }: { colors: string[]; onChange: (index: number, from: string, to: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((color, index) => (
        <StudioColorSwatch key={index} value={color} label={t("studio.colors.swatch", { color })} onChange={(next) => onChange(index, color, next)} />
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
  const reset = () =>
    useStudioStore.getState().applyToPage((page) => ({
      ...page,
      elements: page.elements.map((item) => {
        if (item.id !== element.id || item.kind !== "svg") return item;
        const next = { ...item };
        delete next.colorMap;
        return next;
      }),
    }));
  return (
    <PanelSection title={t("studio.colors.element")}>
      <Swatches colors={colors} onChange={change} />
      {element.kind === "svg" && element.colorMap ? (
        <button type="button" onClick={reset} className="glass-chip inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium">
          <RotateCcw className="size-4" aria-hidden />
          {t("studio.colors.reset")}
        </button>
      ) : null}
    </PanelSection>
  );
}
