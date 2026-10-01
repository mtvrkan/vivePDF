import { describe, expect, it } from "vitest";
import type { OmrMark, OmrScan } from "@/types";
import { emptyKey, gradeScan, keyFromLetters, keyText, parseKeyText, questionStats, questionsTable, resizeKey, reviewItems, studentsTable, toggleKeyOption, type AnswerKey } from "./omrModel";

function mark(state: OmrMark["state"], chosen: number[] = []): OmrMark {
  return { state, chosen, fills: [] };
}

function scan(marks: OmrMark[], extra: Partial<OmrScan> = {}): OmrScan {
  return {
    source: "C:/scans/class.pdf",
    page: 2,
    layout: "VPOMR1;q=5;o=4",
    questions: marks.length,
    options: 4,
    idDigits: 4,
    booklets: 1,
    letterCase: "upper",
    studentId: "2026",
    idMarks: [],
    booklet: null,
    marks,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    pixelScale: 1,
    ...extra,
  };
}

const texts = {
  student: "Student",
  source: "Source",
  booklet: "Booklet",
  correct: "Correct",
  wrong: "Wrong",
  blank: "Blank",
  net: "Net",
  percent: "%",
  question: "Question",
  key: "Key",
  answered: "Answered",
  correctShare: "Correct %",
  blankShare: "Blank %",
  studentsTitle: "Students",
  questionsTitle: "Questions",
  basename: (path: string) => path.split("/").pop() ?? path,
};

describe("answer key text", () => {
  it("reads letters, cancelled and unset questions and groups of accepted answers", () => {
    const { cells, invalid } = parseKeyText("ab c*-(bd)", 4);
    expect(cells).toEqual([
      { kind: "answer", options: [0] },
      { kind: "answer", options: [1] },
      { kind: "answer", options: [2] },
      { kind: "void" },
      { kind: "unset" },
      { kind: "answer", options: [1, 3] },
    ]);
    expect(invalid).toEqual([]);
    expect(keyText(cells)).toBe("ABC*-(BD)");
  });

  it("reports letters that the sheet does not have", () => {
    const { cells, invalid } = parseKeyText("AEQ(AZ)", 4);
    expect(invalid).toEqual(["E", "Q", "(AZ)"]);
    expect(cells.map((cell) => cell.kind)).toEqual(["answer", "unset", "unset", "unset"]);
  });

  it("toggles options, keeps booklets when resized and takes the viewer's answers", () => {
    expect(toggleKeyOption({ kind: "unset" }, 2)).toEqual({ kind: "answer", options: [2] });
    expect(toggleKeyOption({ kind: "answer", options: [2] }, 0)).toEqual({ kind: "answer", options: [0, 2] });
    expect(toggleKeyOption({ kind: "answer", options: [2] }, 2)).toEqual({ kind: "unset" });
    const key = emptyKey(1, 2);
    key[0][1] = { kind: "void" };
    expect(resizeKey(key, 2, 3)).toEqual([
      [{ kind: "unset" }, { kind: "void" }, { kind: "unset" }],
      [{ kind: "unset" }, { kind: "unset" }, { kind: "unset" }],
    ]);
    expect(keyFromLetters([[1, "c"], [3, "B"], [9, "A"], [2, ""]], 3, 4)).toEqual([{ kind: "answer", options: [2] }, { kind: "unset" }, { kind: "answer", options: [1] }]);
  });
});

describe("grading", () => {
  const key: AnswerKey = [parseKeyText("ABC*D-", 4).cells];
  const marks = [mark("single", [0]), mark("single", [3]), mark("multiple", [1, 2]), mark("blank"), mark("unclear", [3, 1]), mark("single", [2])];

  it("counts correct, wrong and blank answers, cancels a question for everyone and skips unkeyed ones", () => {
    const graded = gradeScan(scan(marks), 0, key, 1 / 4, undefined);
    expect(graded.questions.map((question) => question.verdict)).toEqual(["correct", "wrong", "wrong", "void", "unclear", "void"]);
    expect([graded.correct, graded.wrong, graded.blank, graded.graded, graded.pending]).toEqual([2, 2, 1, 5, 1]);
    expect(graded.net).toBe(1.5);
    expect(graded.percent).toBe(30);
  });

  it("uses the teacher's decision for unclear marks, the booklet and the student number", () => {
    const booklets = scan(marks, { booklets: 2, booklet: mark("multiple", [0, 1]), studentId: "20?6" });
    expect(reviewItems([booklets], {}).map((item) => item.kind)).toEqual(["studentId", "booklet", "question"]);
    const twoBooklets: AnswerKey = [key[0], parseKeyText("DDDDDD", 4).cells];
    const graded = gradeScan(booklets, 0, twoBooklets, 0, { booklet: 1, studentId: "2026", answers: { 4: [3] } });
    expect(reviewItems([booklets], { 0: { booklet: 1, studentId: "2026", answers: { 4: [3] } } })).toEqual([]);
    expect(graded.booklet).toBe(1);
    expect(graded.studentId).toBe("2026");
    expect(graded.questions[4].verdict).toBe("correct");
    expect(graded.pending).toBe(0);
  });

  it("does not grade a sheet whose booklet is still unknown", () => {
    const graded = gradeScan(scan(marks, { booklets: 2, booklet: mark("blank") }), 0, [key[0], key[0]], 0, undefined);
    expect(graded.booklet).toBeNull();
    expect(graded.graded).toBe(0);
    expect(graded.questions.every((question) => question.verdict === "void")).toBe(true);
  });

  it("builds the student and question tables for export", () => {
    const graded = [gradeScan(scan(marks), 0, key, 0, undefined), gradeScan(scan([mark("single", [0]), mark("blank"), mark("blank"), mark("blank"), mark("blank"), mark("blank")], { studentId: "0042", page: null }), 1, key, 0, undefined)];
    const students = studentsTable(graded, texts);
    expect(students.header.slice(0, 8)).toEqual(["Student", "Source", "Booklet", "Correct", "Wrong", "Blank", "Net", "%"]);
    expect(students.rows[0].slice(0, 4)).toEqual(["2026", "class.pdf · 2", "A", 2]);
    expect(students.rows[0].slice(8)).toEqual(["A", "D", "BC", "", "?", "C"]);
    expect(students.rows[1][1]).toBe("class.pdf");
    const stats = questionStats(graded, 4);
    expect(stats[0]).toMatchObject({ booklet: 0, question: 1, key: [0], answered: 2, correct: 2, counts: [2, 0, 0, 0] });
    const questions = questionsTable(stats, 4, texts);
    expect(questions.rows[0]).toEqual(["A", 1, "A", 2, 100, 0, 2, 0, 0, 0]);
  });
});
