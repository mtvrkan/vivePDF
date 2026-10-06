import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { StudioTextElement } from "@/types/studio";
import { GraphicSection } from "../graphics/GraphicSection";
import { ArrangeSection } from "./ArrangeSection";
import { DesignColours, ElementColours } from "./ColorSections";
import { ImageFiltersSection } from "./ImageFiltersSection";
import { ImageSection } from "./ImageSection";
import { PageProperties } from "./PageSection";
import { QrSection } from "./QrSection";
import { StyleSections } from "./StyleSections";
import { currentPage, selectedElements, useStudioStore } from "./studioStore";
import { TextSection } from "./TextSection";
import { VectorStrokeSection } from "./VectorStrokeSection";

export function PropertiesPanel() {
  const { t } = useTranslation();
  const page = useStudioStore((state) => currentPage(state));
  const elements = useStudioStore(useShallow((state) => selectedElements(state)));
  if (!page) return null;
  const kinds = new Set(elements.map((element) => element.kind));
  const texts = elements.filter((element): element is StudioTextElement => element.kind === "text");
  const single = elements.length === 1 ? elements[0] : null;
  return (
    <aside aria-label={t("studio.props.label")} className="glass flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border/60" data-testid="studio-properties">
      {elements.length === 0 ? <PageProperties page={page} /> : <ArrangeSection elements={elements} />}
      {elements.length === 0 ? <DesignColours /> : null}
      {single?.kind === "vector" || single?.kind === "svg" ? <ElementColours element={single} /> : null}
      {single?.kind === "vector" ? <VectorStrokeSection element={single} /> : null}
      {texts.length && kinds.size === 1 ? <TextSection elements={texts} /> : null}
      {single?.kind === "image" ? <ImageSection element={single} /> : null}
      {single?.kind === "image" && single.src ? <ImageFiltersSection element={single} /> : null}
      {single?.kind === "qr" ? <QrSection element={single} /> : null}
      {single?.kind === "svg" ? <GraphicSection element={single} /> : null}
      {elements.length ? <StyleSections elements={elements} /> : null}
    </aside>
  );
}
