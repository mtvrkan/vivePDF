import { memo, useEffect } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { StudioElement, StudioTextElement } from "@/types/studio";
import { GraphicSection } from "../graphics/GraphicSection";
import { ArrangeSection } from "./ArrangeSection";
import { DesignColours, ElementColours } from "./ColorSections";
import { ImageFiltersSection } from "./ImageFiltersSection";
import { ImageSection } from "./ImageSection";
import { PageProperties } from "./PageSection";
import { QrSection } from "./QrSection";
import { FinishSection } from "./FinishSection";
import { StyleSections } from "./StyleSections";
import { currentPage, selectedElements, useStudioStore } from "./studioStore";
import { TextSection } from "./TextSection";
import { VectorStrokeSection } from "./VectorStrokeSection";
import { IconButton } from "@/components/shared/IconButton";
import { detailsSectionId, useSidePanelsStore } from "./sidePanels";
import { useHeldWhileInteracting } from "./useHeldWhileInteracting";

const DetailSections = memo(function DetailSections({ elements }: { elements: StudioElement[] }) {
  const kinds = new Set(elements.map((element) => element.kind));
  const texts = elements.filter((element): element is StudioTextElement => element.kind === "text");
  const single = elements.length === 1 ? elements[0] : null;
  return (
    <>
      {single?.kind === "vector" || single?.kind === "svg" ? <ElementColours element={single} /> : null}
      {single?.kind === "vector" ? <VectorStrokeSection element={single} /> : null}
      {texts.length && kinds.size === 1 ? <TextSection elements={texts} /> : null}
      {single?.kind === "image" ? <ImageSection element={single} /> : null}
      {single?.kind === "image" && single.src ? <ImageFiltersSection element={single} /> : null}
      {single?.kind === "qr" ? <QrSection element={single} /> : null}
      {single?.kind === "svg" ? <GraphicSection element={single} /> : null}
      {elements.length ? <StyleSections elements={elements} /> : null}
      {elements.length ? <FinishSection elements={elements} /> : null}
    </>
  );
});

export function PropertiesPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const page = useStudioStore((state) => currentPage(state));
  const elements = useStudioStore(useShallow((state) => selectedElements(state)));
  const details = useHeldWhileInteracting(elements);
  const target = useSidePanelsStore((state) => state.target);
  useEffect(() => {
    if (target) document.getElementById(detailsSectionId(target.section))?.scrollIntoView?.({ block: "start" });
  }, [target]);
  if (!page) return null;
  return (
    <aside aria-label={t("studio.props.label")} className="glass flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border/60" data-testid="studio-properties">
      {onClose ? (
        <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 ps-4 pe-2 backdrop-blur">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("studio.props.label")}</h2>
          <IconButton icon={X} label={t("studio.context.closeDetails")} onClick={onClose} />
        </div>
      ) : null}
      {elements.length === 0 ? <PageProperties page={page} /> : <ArrangeSection elements={elements} />}
      {elements.length === 0 ? <DesignColours /> : null}
      <DetailSections elements={details} />
    </aside>
  );
}

export function DetailsPanel() {
  const open = useSidePanelsStore((state) => state.detailsOpen);
  const close = useSidePanelsStore((state) => state.closeDetails);
  return open ? <PropertiesPanel onClose={close} /> : null;
}
