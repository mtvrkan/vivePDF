import { useTranslation } from "react-i18next";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { isDrawingKind } from "../drawing/drawingSource";
import { shapeDataUrl } from "../shapes/render";
import { AnswerKeyDialog } from "./AnswerKeyDialog";
import { DEFAULT_ANSWER_KEY_LOOK, answerKeyLook, newAnswerKey, type AnswerKeyLook, type AnswerKeySettings } from "./answerKeyModel";
import { questionAnswers } from "./placedQuestions";
import type { AnswerKeySource } from "./questionObject";

let lastLook: AnswerKeyLook = DEFAULT_ANSWER_KEY_LOOK;

export function AnswerKeyEditorHost({ objectId }: { objectId: string | null }) {
  const { t } = useTranslation();
  const objects = useViewerOverlayStore((state) => state.objects);
  const target = objectId ? (objects.find((item) => item.id === objectId) ?? null) : null;
  const editing = isDrawingKind(target, "answerKey") ? target : null;
  const initial: AnswerKeySettings = editing ? editing.drawing.source.settings : newAnswerKey(lastLook, { number: t("viewer.answerKey.numberHeader"), answer: t("viewer.answerKey.answerHeader") }, questionAnswers(objects));

  const close = () => useViewerOverlayStore.getState().closeDrawingEditor();

  const submit = (source: AnswerKeySource) => {
    const store = useViewerOverlayStore.getState();
    const dataUrl = shapeDataUrl(source.svg);
    lastLook = answerKeyLook(source.settings);
    if (editing) {
      const pointsPerUnit = editing.width / editing.drawing.source.width;
      store.snapshot();
      store.updateObject(editing.id, { drawing: { kind: "answerKey", source }, dataUrl, width: source.width * pointsPerUnit, height: source.height * pointsPerUnit, aspect: source.width / source.height } as Partial<EditorPending>);
    } else {
      store.setPendingImage({ dataUrl, width: source.width, height: source.height, path: null, drawing: { kind: "answerKey", source } });
    }
    store.closeDrawingEditor();
  };

  return <AnswerKeyDialog key={objectId ?? "new"} initial={initial} updating={!!editing} onClose={close} onSubmit={submit} />;
}
