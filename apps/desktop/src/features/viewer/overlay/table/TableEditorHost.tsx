import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { isDrawingKind } from "../drawing/drawingSource";
import { shapeDataUrl } from "../shapes/render";
import { TableDialog } from "./TableDialog";
import { DEFAULT_TABLE, freshTable, tableLook, type TableLook, type TableSettings } from "./tableModel";
import type { TableSource } from "./tableObject";

let lastLook: TableLook = tableLook(DEFAULT_TABLE);

export function TableEditorHost({ objectId }: { objectId: string | null }) {
  const target = useViewerOverlayStore((state) => (objectId ? (state.objects.find((item) => item.id === objectId) ?? null) : null));
  const editing = isDrawingKind(target, "table") ? target : null;
  const initial: TableSettings = editing ? editing.drawing.source.settings : freshTable(lastLook);

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = (source: TableSource) => {
    const store = useViewerOverlayStore.getState();
    const dataUrl = shapeDataUrl(source.svg);
    lastLook = tableLook(source.settings);
    if (editing) {
      const pointsPerUnit = editing.width / editing.drawing.source.width;
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "table", source }, dataUrl, width: source.width * pointsPerUnit, height: source.height * pointsPerUnit, aspect: source.width / source.height } as Partial<EditorPending>);
    } else {
      store.setPendingImage({ dataUrl, width: source.width, height: source.height, path: null, drawing: { kind: "table", source } });
    }
    store.closeDrawingEditor();
  };

  return <TableDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
