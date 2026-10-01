import type { LetterCase, QuestionLayout, QuestionSpec } from "@/types";

export const QUESTION_LAYOUTS: readonly QuestionLayout[] = ["auto", "stack", "two", "row"];
export const LETTER_CASES: readonly LetterCase[] = ["upper", "lower"];
export const QUESTION_LIMITS = { options: 8, minOptions: 2, stemChars: 4000, optionChars: 1000, answerLines: 30, number: 9999 } as const;
export const DEFAULT_QUESTION_FONT = "bundled:dejavu-sans";

export type QuestionSettings = {
  number: number | null;
  stem: string;
  options: string[];
  open: boolean;
  layout: QuestionLayout;
  letterCase: LetterCase;
  answer: number | null;
  markAnswer: boolean;
  answerLines: number;
  width: number;
  fontSize: number;
  fontId: string;
  color: string;
  lineColor: string;
};

export type QuestionLook = Pick<QuestionSettings, "layout" | "letterCase" | "width" | "fontSize" | "fontId" | "color" | "lineColor" | "answerLines">;

export const DEFAULT_QUESTION_LOOK: QuestionLook = {
  layout: "auto",
  letterCase: "upper",
  width: 460,
  fontSize: 11,
  fontId: DEFAULT_QUESTION_FONT,
  color: "#111111",
  lineColor: "#9ca3af",
  answerLines: 4,
};

export function questionLook(settings: QuestionSettings): QuestionLook {
  const { layout, letterCase, width, fontSize, fontId, color, lineColor, answerLines } = settings;
  return { layout, letterCase, width, fontSize, fontId, color, lineColor, answerLines };
}

export function newQuestion(look: QuestionLook, number: number): QuestionSettings {
  return { ...look, number, stem: "", options: ["", "", "", ""], open: false, answer: null, markAnswer: false };
}

export function optionLetter(index: number, letterCase: LetterCase): string {
  const letter = String.fromCharCode(65 + index);
  return letterCase === "upper" ? letter : letter.toLowerCase();
}

export function nextQuestionNumber(numbers: ReadonlyArray<number | null>): number {
  return Math.min(QUESTION_LIMITS.number, Math.max(0, ...numbers.map((number) => number ?? 0)) + 1);
}

export function addOption(settings: QuestionSettings): QuestionSettings {
  if (settings.options.length >= QUESTION_LIMITS.options) return settings;
  return { ...settings, options: [...settings.options, ""] };
}

export function removeOption(settings: QuestionSettings, index: number): QuestionSettings {
  if (settings.options.length <= QUESTION_LIMITS.minOptions) return settings;
  const options = settings.options.filter((_, position) => position !== index);
  const answer = settings.answer === null || settings.answer === index ? null : settings.answer > index ? settings.answer - 1 : settings.answer;
  return { ...settings, options, answer };
}

export function setOption(settings: QuestionSettings, index: number, text: string): QuestionSettings {
  return { ...settings, options: settings.options.map((value, position) => (position === index ? text.slice(0, QUESTION_LIMITS.optionChars) : value)) };
}

export function isBlankQuestion(settings: QuestionSettings): boolean {
  return !settings.stem.trim() && (settings.open || settings.options.every((text) => !text.trim()));
}

export function answerLetter(settings: QuestionSettings): string | null {
  if (settings.open || settings.answer === null || settings.answer >= settings.options.length) return null;
  return optionLetter(settings.answer, settings.letterCase);
}

export function toQuestionSpec(settings: QuestionSettings): QuestionSpec {
  const open = settings.open;
  return {
    number: settings.number,
    stem: settings.stem,
    options: open ? [] : settings.options,
    layout: settings.layout,
    letterCase: settings.letterCase,
    answer: open ? null : settings.answer,
    markAnswer: !open && settings.markAnswer,
    answerLines: open ? settings.answerLines : 0,
    width: settings.width,
    fontSize: settings.fontSize,
    fontId: settings.fontId,
    color: settings.color,
    lineColor: settings.lineColor,
  };
}
