import { useTranslation } from "react-i18next";
import { SliderField } from "@/components/tool/form";
import type { StudioElement, StudioFill, StudioShapeElement, StudioStroke } from "@/types/studio";
import { patchSelected } from "./commands";
import { FillEditor, PanelSection, StrokeEditor } from "./controls";
import { deepEqual, isCornerable, isFillable, isLineElement, isRoundable, isShadowable, isStrokable, maxCornerRadius, mergeEdit, sharedValue, strokeDifferences } from "./multiEdit";
import { CornerControls, LineSection, ShadowSection } from "./ShapeSections";

export function StyleSections({ elements }: { elements: StudioElement[] }) {
  const { t } = useTranslation();
  const fillable = elements.filter(isFillable);
  const strokable = elements.filter(isStrokable);
  const roundable = elements.filter(isRoundable);
  const cornerable = elements.filter(isCornerable);
  const lines = elements.filter(isLineElement);
  const shadowable = elements.filter(isShadowable);
  const stars = elements.filter((element): element is StudioShapeElement => element.kind === "shape" && (element.shape === "star" || element.shape === "burst"));
  const fill = sharedValue(fillable.map((element) => element.fill));
  const strokes = strokable.map((element) => element.stroke);
  const shownStroke = strokes.find((stroke) => stroke !== null) ?? null;
  const radius = sharedValue(roundable.map((element) => element.cornerRadius));
  const mixedText = t("studio.props.mixed");
  const openPath = lines.length === elements.length;
  const setFill = (next: StudioFill, merge?: string) => patchSelected((element) => (isFillable(element) ? { fill: mergeEdit(element.fill, fill.value, next) } : {}), merge);
  const setStroke = (next: StudioStroke | null, merge?: string) =>
    patchSelected((element) => {
      if (!isStrokable(element)) return {};
      const turnOn = element.stroke === null && next !== null && deepEqual(shownStroke, next);
      return { stroke: turnOn ? next : mergeEdit(element.stroke, shownStroke, next) };
    }, merge);
  const setShape = (patch: Partial<StudioShapeElement>, merge: string) => patchSelected((element) => (element.kind === "shape" ? patch : {}), merge);
  return (
    <>
      {fillable.length === elements.length ? (
        <PanelSection title={t("studio.props.fill")}>
          <FillEditor value={fill.value} mixed={fill.mixed} onChange={setFill} />
        </PanelSection>
      ) : null}
      {strokable.length === elements.length ? (
        <PanelSection title={t("studio.props.stroke")}>
          <StrokeEditor value={shownStroke} mixed={strokeDifferences(strokes)} openPath={openPath} onChange={setStroke} />
          {cornerable.length === elements.length ? (
            <CornerControls elements={cornerable} />
          ) : roundable.length === elements.length ? (
            <SliderField
              label={t("studio.props.cornerRadius")}
              value={radius.value}
              min={0}
              max={maxCornerRadius(roundable)}
              format={(value) => (radius.mixed ? mixedText : String(value))}
              onChange={(cornerRadius) => patchSelected((element) => (isRoundable(element) ? { cornerRadius } : {}), "radius")}
            />
          ) : null}
        </PanelSection>
      ) : null}
      {lines.length === elements.length ? <LineSection elements={lines} /> : null}
      {stars.length === elements.length ? (
        <PanelSection title={t("studio.props.shape")}>
          <SliderField label={t("studio.props.points")} value={stars[0].points} min={3} max={48} onChange={(points) => setShape({ points }, "points")} />
          <SliderField label={t("studio.props.innerRatio")} value={Math.round(stars[0].innerRatio * 100)} min={10} max={95} format={(value) => `${value}%`} onChange={(value) => setShape({ innerRatio: value / 100 }, "inner")} />
        </PanelSection>
      ) : null}
      {shadowable.length === elements.length ? <ShadowSection elements={shadowable} /> : null}
    </>
  );
}
