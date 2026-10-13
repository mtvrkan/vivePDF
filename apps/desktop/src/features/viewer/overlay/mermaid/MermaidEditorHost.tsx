import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { shapeDataUrl } from "../shapes/render";
import { isDrawingKind } from "../drawing/drawingSource";
import { MermaidDialog } from "./MermaidDialog";
import { DEFAULT_MERMAID_THEME, placedScale, type MermaidTheme } from "./mermaidModel";
import type { MermaidSource } from "./mermaidObject";

let lastTheme: MermaidTheme = DEFAULT_MERMAID_THEME;

export function MermaidEditorHost({ objectId }: { objectId: string | null }) {
  const target = useViewerOverlayStore((state) => (objectId ? (state.objects.find((item) => item.id === objectId) ?? null) : null));
  const editing = isDrawingKind(target, "mermaid") ? target : null;
  const initial = editing ? editing.drawing.source.settings : { code: "", theme: lastTheme };

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = (source: MermaidSource) => {
    const store = useViewerOverlayStore.getState();
    const dataUrl = shapeDataUrl(source.svg);
    lastTheme = source.settings.theme;
    if (editing) {
      const pointsPerUnit = editing.width / editing.drawing.source.width;
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "mermaid", source }, dataUrl, width: source.width * pointsPerUnit, height: source.height * pointsPerUnit, aspect: source.width / source.height } as Partial<EditorPending>);
    } else {
      const scale = placedScale(source.width, source.height);
      store.setPendingImage({ dataUrl, width: source.width * scale, height: source.height * scale, path: null, drawing: { kind: "mermaid", source } });
    }
    store.closeDrawingEditor();
  };

  return <MermaidDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
