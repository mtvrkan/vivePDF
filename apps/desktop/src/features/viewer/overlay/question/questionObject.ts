import type { AnswerKeySettings } from "./answerKeyModel";
import type { QuestionSettings } from "./questionModel";

export type QuestionSource = { settings: QuestionSettings; svg: string; width: number; height: number };
export type AnswerKeySource = { settings: AnswerKeySettings; svg: string; width: number; height: number };
