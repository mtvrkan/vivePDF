import { useTranslation } from "react-i18next";
import { currentLocale } from "@/app/i18n";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { isDrawingKind } from "../drawing/drawingSource";
import { shapeDataUrl } from "../shapes/render";
import { ChartDialog } from "./ChartDialog";
import { DEFAULT_CHART_LOOK, chartLook, decimalOf, newChart, sampleCells, type ChartLook, type ChartSettings } from "./chartModel";
import type { ChartSource } from "./chartObject";

let lastLook: ChartLook | null = null;

export function ChartEditorHost({ objectId }: { objectId: string | null }) {
  const { t } = useTranslation();
  const target = useViewerOverlayStore((state) => (objectId ? (state.objects.find((item) => item.id === objectId) ?? null) : null));
  const editing = isDrawingKind(target, "chart") ? target : null;
  const initial: ChartSettings = editing
    ? editing.drawing.source.settings
    : newChart(
        { ...(lastLook ?? DEFAULT_CHART_LOOK), decimal: decimalOf(currentLocale()) },
        sampleCells(
          (number) => t("viewer.chart.sample.series", { number }),
          (number) => t("viewer.chart.sample.category", { number }),
        ),
      );

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = (source: ChartSource) => {
    const store = useViewerOverlayStore.getState();
    const dataUrl = shapeDataUrl(source.svg);
    lastLook = chartLook(source.settings);
    if (editing) {
      const pointsPerUnit = editing.width / editing.drawing.source.width;
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "chart", source }, dataUrl, width: source.width * pointsPerUnit, height: source.height * pointsPerUnit, aspect: source.width / source.height } as Partial<EditorPending>);
    } else {
      store.setPendingImage({ dataUrl, width: source.width, height: source.height, path: null, drawing: { kind: "chart", source } });
    }
    store.closeDrawingEditor();
  };

  return <ChartDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
