import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { shapeDataUrl, DEFAULT_SHAPE_STYLE } from "./render";
import { ShapeDialog, type ShapeDraft } from "./ShapeDialog";
import { isDrawingKind } from "../drawing/drawingSource";
import type { ShapeSource } from "./shapeObject";

let lastDraft: ShapeDraft = { id: "cube", params: {}, style: DEFAULT_SHAPE_STYLE };

export function ShapeEditorHost({ objectId }: { objectId: string | null }) {
  const target = useViewerOverlayStore((state) => (objectId ? (state.objects.find((item) => item.id === objectId) ?? null) : null));
  const editing = isDrawingKind(target, "shape") ? target : null;
  const initial: ShapeDraft = editing ? { id: editing.drawing.source.id, params: editing.drawing.source.params, style: editing.drawing.source.style } : lastDraft;

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = (source: ShapeSource) => {
    const store = useViewerOverlayStore.getState();
    const dataUrl = shapeDataUrl(source.svg);
    lastDraft = { id: source.id, params: source.params, style: source.style };
    if (editing) {
      const pointsPerUnit = editing.width / editing.drawing.source.width;
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "shape", source }, dataUrl, width: source.width * pointsPerUnit, height: source.height * pointsPerUnit, aspect: source.width / source.height } as Partial<EditorPending>);
    } else {
      store.setPendingImage({ dataUrl, width: source.width, height: source.height, path: null, drawing: { kind: "shape", source } });
    }
    store.closeDrawingEditor();
  };

  return <ShapeDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
