import { useTranslation } from "react-i18next";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { isDrawingKind } from "../drawing/drawingSource";
import { shapeDataUrl } from "../shapes/render";
import { FlowchartDialog } from "./FlowchartDialog";
import { DEFAULT_FLOW_LOOK, flowchartLook, newFlowchart, type FlowchartLook, type FlowchartSettings } from "./flowchartModel";
import type { FlowchartSource } from "./flowchartObject";

let lastLook: FlowchartLook = DEFAULT_FLOW_LOOK;

export function FlowchartEditorHost({ objectId }: { objectId: string | null }) {
  const { t } = useTranslation();
  const target = useViewerOverlayStore((state) => (objectId ? (state.objects.find((item) => item.id === objectId) ?? null) : null));
  const editing = isDrawingKind(target, "flowchart") ? target : null;
  const initial: FlowchartSettings = editing ? editing.drawing.source.settings : newFlowchart(lastLook, { start: t("viewer.flowchart.sample.start"), step: t("viewer.flowchart.sample.step"), end: t("viewer.flowchart.sample.end") });

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = (source: FlowchartSource) => {
    const store = useViewerOverlayStore.getState();
    const dataUrl = shapeDataUrl(source.svg);
    lastLook = flowchartLook(source.settings);
    if (editing) {
      const pointsPerUnit = editing.width / editing.drawing.source.width;
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "flowchart", source }, dataUrl, width: source.width * pointsPerUnit, height: source.height * pointsPerUnit, aspect: source.width / source.height } as Partial<EditorPending>);
    } else {
      store.setPendingImage({ dataUrl, width: source.width, height: source.height, path: null, drawing: { kind: "flowchart", source } });
    }
    store.closeDrawingEditor();
  };

  return <FlowchartDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
