import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { FormulaDialog, type FormulaDraft, type FormulaSubmit } from "./FormulaDialog";
import { isDrawingKind } from "../drawing/drawingSource";
import { DEFAULT_FORMULA_COLOR, DEFAULT_FORMULA_SIZE, formulaBox, formulaDataUrl, formulaSizeOf } from "./formulaSvg";

let lastDraft: Pick<FormulaDraft, "color" | "size"> = { color: DEFAULT_FORMULA_COLOR, size: DEFAULT_FORMULA_SIZE };

export function FormulaEditorHost({ objectId }: { objectId: string | null }) {
  const target = useViewerOverlayStore((state) => (objectId ? (state.objects.find((item) => item.id === objectId) ?? null) : null));
  const editing = isDrawingKind(target, "formula") ? target : null;
  const initial: FormulaDraft = editing
    ? { latex: editing.drawing.source.latex, color: editing.drawing.source.color, size: formulaSizeOf(editing.drawing.source, editing.width) }
    : { latex: "", ...lastDraft };

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = ({ formula, size }: FormulaSubmit) => {
    const store = useViewerOverlayStore.getState();
    const box = formulaBox(formula, size);
    const dataUrl = formulaDataUrl(formula);
    lastDraft = { color: formula.color, size };
    if (editing) {
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "formula", source: formula }, dataUrl, width: box.width, height: box.height, aspect: box.width / box.height } as Partial<EditorPending>);
    } else {
      store.setPendingImage({ dataUrl, width: box.width, height: box.height, path: null, drawing: { kind: "formula", source: formula } });
    }
    store.closeDrawingEditor();
  };

  return <FormulaDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
