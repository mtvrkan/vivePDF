import { describe, expect, it } from "vitest";
import type { EditorPending } from "@/shared/store/viewerOverlayStore";
import { applyAnswerKeyEdit, DEFAULT_ANSWER_KEY_LOOK, effectiveGroups, isBlankAnswerKey, newAnswerKey, toAnswerKeyTable } from "./answerKeyModel";
import { questionAnswers } from "./placedQuestions";
import { DEFAULT_QUESTION_LOOK, QUESTION_LIMITS, addOption, answerLetter, isBlankQuestion, newQuestion, nextQuestionNumber, optionLetter, removeOption, toQuestionSpec, type QuestionSettings } from "./questionModel";

const base: QuestionSettings = { ...newQuestion(DEFAULT_QUESTION_LOOK, 1), stem: "2 + 2?", options: ["3", "4", "5", "6"], answer: 1 };

function placed(settings: QuestionSettings, id: string): EditorPending {
  return { id, kind: "image", pageIndex: 0, x: 0, y: 0, width: 10, height: 10, dataUrl: "", path: null, aspect: 1, opacity: 1, drawing: { kind: "question", source: { settings, svg: "<svg/>", width: 10, height: 10 } } };
}

describe("question settings", () => {
  it("numbers a new question after the highest one placed, skipping unnumbered ones", () => {
    expect(nextQuestionNumber([])).toBe(1);
    expect(nextQuestionNumber([3, null, 7, 2])).toBe(8);
    expect(nextQuestionNumber([QUESTION_LIMITS.number])).toBe(QUESTION_LIMITS.number);
  });

  it("keeps the marked answer on the same option when an earlier option is removed", () => {
    const withAnswer = { ...base, answer: 3 };
    expect(removeOption(withAnswer, 1)).toMatchObject({ options: ["3", "5", "6"], answer: 2 });
    expect(removeOption(withAnswer, 3).answer).toBeNull();
    expect(removeOption({ ...base, options: ["a", "b"] }, 0).options).toEqual(["a", "b"]);
  });

  it("stops adding options at the limit", () => {
    const full = { ...base, options: Array.from({ length: QUESTION_LIMITS.options }, () => "x") };
    expect(addOption(full)).toBe(full);
    expect(addOption(base).options).toHaveLength(5);
  });

  it("sends an open question without options and a choice question without answer lines", () => {
    expect(toQuestionSpec({ ...base, open: true, answerLines: 5, markAnswer: true })).toMatchObject({ options: [], answer: null, markAnswer: false, answerLines: 5 });
    expect(toQuestionSpec({ ...base, answerLines: 5 })).toMatchObject({ options: ["3", "4", "5", "6"], answer: 1, answerLines: 0 });
  });

  it("treats a question without text as blank", () => {
    expect(isBlankQuestion({ ...base, stem: " ", options: ["", " "] })).toBe(true);
    expect(isBlankQuestion({ ...base, stem: "", options: ["", "x"] })).toBe(false);
    expect(isBlankQuestion({ ...base, stem: "", options: ["x"], open: true })).toBe(true);
  });

  it("names the answer with the letter style the question uses", () => {
    expect(optionLetter(2, "upper")).toBe("C");
    expect(answerLetter({ ...base, letterCase: "lower" })).toBe("b");
    expect(answerLetter({ ...base, open: true })).toBeNull();
    expect(answerLetter({ ...base, answer: null })).toBeNull();
  });
});

describe("answer key", () => {
  it("collects the placed questions' answers in number order", () => {
    const objects = [placed({ ...base, number: 3, answer: 0 }, "a"), placed({ ...base, number: 1 }, "b"), placed({ ...base, number: null }, "c"), placed({ ...base, number: 2, open: true }, "d")];
    expect(questionAnswers(objects)).toEqual([
      [1, "B"],
      [2, ""],
      [3, "A"],
    ]);
  });

  it("uses more column pairs when the answers would not fit one table", () => {
    const many = newAnswerKey({ ...DEFAULT_ANSWER_KEY_LOOK, groups: 1 }, { number: "No", answer: "Key" }, Array.from({ length: 130 }, (_, index) => [index + 1, "A"] as [number, string]));
    expect(effectiveGroups(many)).toBe(3);
    const spec = toAnswerKeyTable(many);
    expect(spec.cells).toHaveLength(1 + 44);
    expect(spec.cells[0]).toHaveLength(6);
  });

  it("never splits a short key into more pairs than it has answers", () => {
    const short = newAnswerKey({ ...DEFAULT_ANSWER_KEY_LOOK, groups: 8 }, { number: "No", answer: "Key" }, [[1, "A"], [2, "B"]]);
    expect(effectiveGroups(short)).toBe(2);
  });

  it("is blank until a row has a number or an answer", () => {
    const empty = newAnswerKey(DEFAULT_ANSWER_KEY_LOOK, { number: "No", answer: "Key" }, []);
    expect(isBlankAnswerKey(empty)).toBe(true);
    const typed = applyAnswerKeyEdit(empty, { kind: "setCell", row: 0, column: 1, text: "D" });
    expect(isBlankAnswerKey(typed)).toBe(false);
    expect(applyAnswerKeyEdit(typed, { kind: "addColumn" }).cells[0]).toHaveLength(2);
  });
});
