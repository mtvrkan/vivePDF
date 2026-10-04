import { useTranslation } from "react-i18next";
import { SliderField } from "@/components/tool/form";
import type { StudioVectorElement } from "@/types/studio";
import { vectorStrokeWidth, withVectorStrokeWidth } from "../model/vectorStroke";
import { patchSelected } from "./commands";
import { PanelSection } from "./controls";

const MIN_WIDTH = 0.25;
const MAX_WIDTH = 40;

export function VectorStrokeSection({ element }: { element: StudioVectorElement }) {
  const { t } = useTranslation();
  const width = vectorStrokeWidth(element);
  if (width === null) return null;
  return (
    <PanelSection title={t("studio.props.stroke")}>
      <SliderField
        label={t("studio.stroke.width")}
        value={width}
        min={MIN_WIDTH}
        max={Math.max(MAX_WIDTH, width)}
        step={0.25}
        format={(value) => `${value} pt`}
        onChange={(value) => patchSelected((item) => (item.kind === "vector" && !item.locked ? withVectorStrokeWidth(item, value) : {}), `vector-stroke-${element.id}`)}
      />
    </PanelSection>
  );
}
