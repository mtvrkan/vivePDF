import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { shapeDataUrl } from "../shapes/render";
import { GraphDialog } from "./GraphDialog";
import { isDrawingKind } from "../drawing/drawingSource";
import type { GraphSource } from "./graphObject";
import { DEFAULT_GRAPH, type GraphSettings } from "./plot";

let lastSettings: GraphSettings = DEFAULT_GRAPH;

export function GraphEditorHost({ objectId }: { objectId: string | null }) {
  const target = useViewerOverlayStore((state) => (objectId ? (state.objects.find((item) => item.id === objectId) ?? null) : null));
  const editing = isDrawingKind(target, "graph") ? target : null;
  const initial = editing ? editing.drawing.source.settings : lastSettings;

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = (source: GraphSource) => {
    const store = useViewerOverlayStore.getState();
    const dataUrl = shapeDataUrl(source.svg);
    lastSettings = source.settings;
    if (editing) {
      const pointsPerUnit = editing.width / editing.drawing.source.width;
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "graph", source }, dataUrl, width: source.width * pointsPerUnit, height: source.height * pointsPerUnit, aspect: source.width / source.height } as Partial<EditorPending>);
    } else {
      store.setPendingImage({ dataUrl, width: source.width, height: source.height, path: null, drawing: { kind: "graph", source } });
    }
    store.closeDrawingEditor();
  };

  return <GraphDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
