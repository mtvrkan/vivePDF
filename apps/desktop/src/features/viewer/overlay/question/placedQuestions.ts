import type { EditorPending } from "@/shared/store/viewerOverlayStore";
import { isDrawingKind } from "../drawing/drawingSource";
import { answerLetter, type QuestionSettings } from "./questionModel";

export function placedQuestions(objects: readonly EditorPending[]): QuestionSettings[] {
  const found: QuestionSettings[] = [];
  for (const item of objects) if (isDrawingKind(item, "question")) found.push(item.drawing.source.settings);
  return found;
}

export function questionAnswers(objects: readonly EditorPending[]): [number, string][] {
  const answers = new Map<number, string>();
  for (const settings of placedQuestions(objects)) {
    if (settings.number !== null) answers.set(settings.number, answerLetter(settings) ?? answers.get(settings.number) ?? "");
  }
  return [...answers.entries()].sort(([first], [second]) => first - second);
}
