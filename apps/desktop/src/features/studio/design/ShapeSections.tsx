import { ArrowLeftRight, Link2, Unlink2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SliderField, SwitchField } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { STUDIO_ARROWHEADS, type StudioArrowhead, type StudioDropShadow, type StudioShapeElement } from "@/types/studio";
import { DEFAULT_DROP_SHADOW, MAX_ARROW_SIZE, MIN_ARROW_SIZE } from "../model/design";
import { patchSelected } from "./commands";
import { ColorField, MixedHint, NumberField, OpacityField, PanelSection, SelectField } from "./controls";
import { cornersOf, deepEqual, isCornerable, isLineElement, isShadowable, maxCornerRadius, mergeEdit, shadowDifferences, sharedValue, withCorner, type ShadowableElement } from "./multiEdit";

const SHADOW_OFFSET_LIMIT = 50;
const SHADOW_BLUR_LIMIT = 60;
const CORNER_KEYS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

export function ShadowSection({ elements }: { elements: ShadowableElement[] }) {
  const { t } = useTranslation();
  const shadows = elements.map((element) => element.dropShadow);
  const shown = shadows.find((shadow) => shadow !== null) ?? null;
  const differs = shadowDifferences(shadows);
  const mixedText = t("studio.props.mixed");
  const set = (next: StudioDropShadow | null, merge?: string) =>
    patchSelected((element) => {
      if (!isShadowable(element)) return {};
      const turnOn = element.dropShadow === null && next !== null && deepEqual(shown, next);
      return { dropShadow: turnOn ? next : mergeEdit(element.dropShadow, shown, next) };
    }, merge);
  const offset = (key: "x" | "y", label: string) =>
    shown ? (
      <SliderField
        label={label}
        value={shown[key]}
        min={-SHADOW_OFFSET_LIMIT}
        max={SHADOW_OFFSET_LIMIT}
        step={0.5}
        format={(value) => (differs.has(key) ? mixedText : `${value} pt`)}
        onChange={(value) => set({ ...shown, [key]: value }, `shadow-${key}`)}
      />
    ) : null;
  return (
    <PanelSection title={t("studio.shadow.title")}>
      <SwitchField label={t("studio.shadow.on")} hint={t("studio.shadow.hint")} checked={shown !== null} onChange={(on) => set(on ? (shown ?? DEFAULT_DROP_SHADOW) : null)} />
      {differs.size ? <MixedHint /> : null}
      {shown ? (
        <div data-testid="studio-shadow-fields" className="space-y-3">
          <ColorField label={t("studio.shadow.color")} value={shown.color} mixed={differs.has("color")} onChange={(color) => set({ ...shown, color }, "shadow-color")} />
          <OpacityField label={t("studio.shadow.opacity")} value={shown.opacity} mixed={differs.has("opacity")} onChange={(opacity) => set({ ...shown, opacity }, "shadow-opacity")} />
          <div className="grid grid-cols-2 gap-x-3">
            {offset("x", t("studio.shadow.x"))}
            {offset("y", t("studio.shadow.y"))}
          </div>
          <SliderField
            label={t("studio.shadow.blur")}
            value={shown.blur}
            min={0}
            max={SHADOW_BLUR_LIMIT}
            step={0.5}
            format={(value) => (differs.has("blur") ? mixedText : `${value} pt`)}
            onChange={(blur) => set({ ...shown, blur }, "shadow-blur")}
          />
        </div>
      ) : null}
    </PanelSection>
  );
}

export function LineSection({ elements }: { elements: StudioShapeElement[] }) {
  const { t } = useTranslation();
  const start = sharedValue(elements.map((element) => element.startArrow));
  const end = sharedValue(elements.map((element) => element.endArrow));
  const size = sharedValue(elements.map((element) => element.arrowSize));
  const mixedText = t("studio.props.mixed");
  const set = (patch: (element: StudioShapeElement) => Partial<StudioShapeElement>, merge?: string) => patchSelected((element) => (isLineElement(element) ? patch(element) : {}), merge);
  const options = STUDIO_ARROWHEADS.map((kind) => ({ value: kind, label: t(`studio.arrows.kinds.${kind}`) }));
  const anyHead = elements.some((element) => element.startArrow !== "none" || element.endArrow !== "none");
  return (
    <PanelSection title={t("studio.arrows.title")}>
      <div className="grid grid-cols-2 gap-2">
        <SelectField label={t("studio.arrows.start")} value={start.mixed ? "" : start.value} placeholder={mixedText} options={options} onChange={(kind) => set(() => ({ startArrow: kind as StudioArrowhead }))} />
        <SelectField label={t("studio.arrows.end")} value={end.mixed ? "" : end.value} placeholder={mixedText} options={options} onChange={(kind) => set(() => ({ endArrow: kind as StudioArrowhead }))} />
      </div>
      <button type="button" className="glass-chip inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium" onClick={() => set((element) => ({ startArrow: element.endArrow, endArrow: element.startArrow }))}>
        <ArrowLeftRight className="size-4" aria-hidden />
        {t("studio.arrows.swap")}
      </button>
      {anyHead ? (
        <SliderField
          label={t("studio.arrows.size")}
          value={Math.round(size.value * 100)}
          min={MIN_ARROW_SIZE * 100}
          max={MAX_ARROW_SIZE * 100}
          step={10}
          format={(value) => (size.mixed ? mixedText : `${value}%`)}
          onChange={(value) => set(() => ({ arrowSize: value / 100 }), "arrow-size")}
        />
      ) : null}
    </PanelSection>
  );
}

export function CornerControls({ elements }: { elements: StudioShapeElement[] }) {
  const { t } = useTranslation();
  const linked = elements.every((element) => element.corners === null);
  const limit = maxCornerRadius(elements);
  const radius = sharedValue(elements.map((element) => element.cornerRadius));
  const mixedText = t("studio.props.mixed");
  const set = (patch: (element: StudioShapeElement) => Partial<StudioShapeElement>, merge?: string) => patchSelected((element) => (isCornerable(element) ? patch(element) : {}), merge);
  const toggle = () => set((element) => (linked ? { corners: cornersOf(element) } : { corners: null, cornerRadius: cornersOf(element)[0] }));
  const label = linked ? t("studio.corners.unlink") : t("studio.corners.link");
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          {linked ? (
            <SliderField label={t("studio.props.cornerRadius")} value={radius.value} min={0} max={limit} format={(value) => (radius.mixed ? mixedText : String(value))} onChange={(cornerRadius) => set(() => ({ cornerRadius }), "radius")} />
          ) : (
            <span className="block text-sm font-medium text-foreground/80">{t("studio.props.cornerRadius")}</span>
          )}
        </div>
        <button
          type="button"
          aria-label={t("studio.corners.separate")}
          aria-pressed={!linked}
          title={label}
          data-testid="studio-corners-toggle"
          onClick={toggle}
          className={cn("nav-glass inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground/80 hover:text-foreground", !linked && "glass-chip text-primary")}
        >
          {linked ? <Link2 className="size-4" aria-hidden /> : <Unlink2 className="size-4" aria-hidden />}
        </button>
      </div>
      {linked ? null : (
        <div className="grid grid-cols-2 gap-2" data-testid="studio-corner-fields">
          {CORNER_KEYS.map((key, index) => {
            const value = sharedValue(elements.map((element) => cornersOf(element)[index]));
            return (
              <NumberField
                key={key}
                label={t(`studio.corners.${key}`)}
                suffix="pt"
                value={Math.round(value.value * 100) / 100}
                mixed={value.mixed}
                min={0}
                max={limit}
                onChange={(next) => set((element) => ({ corners: withCorner(element, index, next) }), `corner-${key}`)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
