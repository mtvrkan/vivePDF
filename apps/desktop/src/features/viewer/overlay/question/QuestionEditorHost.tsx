import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { isDrawingKind } from "../drawing/drawingSource";
import { shapeDataUrl } from "../shapes/render";
import { placedQuestions } from "./placedQuestions";
import { QuestionDialog } from "./QuestionDialog";
import { DEFAULT_QUESTION_LOOK, newQuestion, nextQuestionNumber, questionLook, type QuestionLook, type QuestionSettings } from "./questionModel";
import type { QuestionSource } from "./questionObject";

let lastLook: QuestionLook = DEFAULT_QUESTION_LOOK;

export function QuestionEditorHost({ objectId }: { objectId: string | null }) {
  const objects = useViewerOverlayStore((state) => state.objects);
  const target = objectId ? (objects.find((item) => item.id === objectId) ?? null) : null;
  const editing = isDrawingKind(target, "question") ? target : null;
  const initial: QuestionSettings = editing ? editing.drawing.source.settings : newQuestion(lastLook, nextQuestionNumber(placedQuestions(objects).map((settings) => settings.number)));

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = (source: QuestionSource) => {
    const store = useViewerOverlayStore.getState();
    const dataUrl = shapeDataUrl(source.svg);
    lastLook = questionLook(source.settings);
    if (editing) {
      const pointsPerUnit = editing.width / editing.drawing.source.width;
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "question", source }, dataUrl, width: source.width * pointsPerUnit, height: source.height * pointsPerUnit, aspect: source.width / source.height } as Partial<EditorPending>);
    } else {
      store.setPendingImage({ dataUrl, width: source.width, height: source.height, path: null, drawing: { kind: "question", source } });
    }
    store.closeDrawingEditor();
  };

  return <QuestionDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
