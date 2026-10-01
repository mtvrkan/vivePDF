import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { shapeDataUrl } from "../shapes/render";
import { isDrawingKind } from "../drawing/drawingSource";
import { MoleculeDialog } from "./MoleculeDialog";
import { DEFAULT_MOLECULE_LOOK, MOLECULE_POINTS_PER_UNIT, type MoleculeSettings } from "./moleculeModel";
import type { MoleculeSource } from "./moleculeObject";

let lastSettings: MoleculeSettings = { ...DEFAULT_MOLECULE_LOOK, smiles: "" };

export function MoleculeEditorHost({ objectId }: { objectId: string | null }) {
  const target = useViewerOverlayStore((state) => (objectId ? (state.objects.find((item) => item.id === objectId) ?? null) : null));
  const editing = isDrawingKind(target, "molecule") ? target : null;
  const initial = editing ? editing.drawing.source.settings : { ...lastSettings, smiles: "" };

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = (source: MoleculeSource) => {
    const store = useViewerOverlayStore.getState();
    const dataUrl = shapeDataUrl(source.svg);
    lastSettings = source.settings;
    if (editing) {
      const pointsPerUnit = editing.width / editing.drawing.source.width;
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "molecule", source }, dataUrl, width: source.width * pointsPerUnit, height: source.height * pointsPerUnit, aspect: source.width / source.height } as Partial<EditorPending>);
    } else {
      store.setPendingImage({ dataUrl, width: source.width * MOLECULE_POINTS_PER_UNIT, height: source.height * MOLECULE_POINTS_PER_UNIT, path: null, drawing: { kind: "molecule", source } });
    }
    store.closeDrawingEditor();
  };

  return <MoleculeDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
