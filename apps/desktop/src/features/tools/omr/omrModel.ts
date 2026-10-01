import type { OmrMark, OmrReviewQuestion, OmrScan, OmrTable } from "@/types";

export const OMR_LIMITS = { questions: 200, options: { min: 2, max: 8 }, digits: 12, booklets: 4, copies: 500 } as const;
export const PENALTIES = [0, 1 / 4, 1 / 3] as const;
export type Penalty = (typeof PENALTIES)[number];

export type KeyCell = { kind: "unset" } | { kind: "void" } | { kind: "answer"; options: number[] };
export type AnswerKey = KeyCell[][];

export type ScanOverride = { answers?: Record<number, number[]>; booklet?: number; studentId?: string };
export type Overrides = Record<number, ScanOverride>;

export type Verdict = OmrReviewQuestion["verdict"];
export type GradedQuestion = { chosen: number[]; key: number[]; verdict: Verdict };
export type GradedScan = {
  index: number;
  scan: OmrScan;
  studentId: string;
  booklet: number | null;
  questions: GradedQuestion[];
  correct: number;
  wrong: number;
  blank: number;
  graded: number;
  net: number;
  percent: number;
  pending: number;
};

export type ReviewItem =
  | { kind: "question"; scan: number; question: number; candidates: number[]; state: OmrMark["state"] }
  | { kind: "booklet"; scan: number }
  | { kind: "studentId"; scan: number; read: string };

const UNSET: KeyCell = { kind: "unset" };

export function optionLetter(index: number, lowerCase = false): string {
  const letter = String.fromCharCode(65 + index);
  return lowerCase ? letter.toLowerCase() : letter;
}

export function bookletLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export function emptyKey(booklets: number, questions: number): AnswerKey {
  return Array.from({ length: Math.max(1, booklets) }, () => Array.from({ length: questions }, () => UNSET));
}

export function resizeKey(key: AnswerKey, booklets: number, questions: number): AnswerKey {
  return Array.from({ length: Math.max(1, booklets) }, (_, booklet) => Array.from({ length: questions }, (_, question) => key[booklet]?.[question] ?? UNSET));
}

export function parseKeyText(text: string, options: number): { cells: KeyCell[]; invalid: string[] } {
  const cells: KeyCell[] = [];
  const invalid: string[] = [];
  const compact = text.replace(/[\s,;.]+/g, "").toUpperCase();
  let position = 0;
  const optionOf = (character: string) => {
    const index = character.charCodeAt(0) - 65;
    return index >= 0 && index < options ? index : -1;
  };
  while (position < compact.length) {
    const character = compact[position];
    if (character === "(") {
      const end = compact.indexOf(")", position);
      const group = end === -1 ? compact.slice(position + 1) : compact.slice(position + 1, end);
      const picked = [...new Set([...group].map(optionOf))];
      if (picked.length === 0 || picked.includes(-1)) {
        invalid.push(`(${group})`);
        cells.push(UNSET);
      } else {
        cells.push({ kind: "answer", options: picked.sort((first, second) => first - second) });
      }
      position = end === -1 ? compact.length : end + 1;
      continue;
    }
    if (character === "*" || character === "X") cells.push({ kind: "void" });
    else if (character === "-" || character === "_" || character === "?") cells.push(UNSET);
    else if (optionOf(character) >= 0) cells.push({ kind: "answer", options: [optionOf(character)] });
    else {
      invalid.push(character);
      cells.push(UNSET);
    }
    position += 1;
  }
  return { cells, invalid };
}

export function keyText(cells: readonly KeyCell[]): string {
  return cells
    .map((cell) => {
      if (cell.kind === "unset") return "-";
      if (cell.kind === "void") return "*";
      const letters = cell.options.map((option) => optionLetter(option)).join("");
      return cell.options.length > 1 ? `(${letters})` : letters;
    })
    .join("");
}

export function applyKeyText(row: readonly KeyCell[], text: string, options: number): { cells: KeyCell[]; invalid: string[] } {
  const parsed = parseKeyText(text, options);
  return { cells: row.map((_, index) => parsed.cells[index] ?? UNSET), invalid: parsed.invalid };
}

export function toggleKeyOption(cell: KeyCell, option: number): KeyCell {
  if (cell.kind !== "answer") return { kind: "answer", options: [option] };
  if (cell.options.includes(option)) {
    const rest = cell.options.filter((value) => value !== option);
    return rest.length ? { kind: "answer", options: rest } : UNSET;
  }
  return { kind: "answer", options: [...cell.options, option].sort((first, second) => first - second) };
}

export function keyFromLetters(entries: ReadonlyArray<[number, string]>, questions: number, options: number): KeyCell[] {
  const row: KeyCell[] = Array.from({ length: questions }, () => UNSET);
  for (const [number, letter] of entries) {
    const index = letter.trim().toUpperCase().charCodeAt(0) - 65;
    if (number >= 1 && number <= questions && index >= 0 && index < options) row[number - 1] = { kind: "answer", options: [index] };
  }
  return row;
}

export function filledKeyCount(row: readonly KeyCell[]): number {
  return row.filter((cell) => cell.kind !== "unset").length;
}

function markedChoice(mark: OmrMark): number[] | null {
  if (mark.state === "single" || mark.state === "multiple") return mark.chosen;
  if (mark.state === "blank") return [];
  return null;
}

function scanBooklet(scan: OmrScan, override: ScanOverride | undefined): number | null {
  if (override?.booklet !== undefined) return override.booklet;
  if (scan.booklets <= 1) return 0;
  return scan.booklet && scan.booklet.state === "single" ? scan.booklet.chosen[0] : null;
}

export function reviewItems(scans: readonly OmrScan[], overrides: Overrides): ReviewItem[] {
  const items: ReviewItem[] = [];
  scans.forEach((scan, index) => {
    const override = overrides[index];
    if (scan.idDigits > 0 && scan.studentId.includes("?") && override?.studentId === undefined) items.push({ kind: "studentId", scan: index, read: scan.studentId });
    if (scanBooklet(scan, override) === null) items.push({ kind: "booklet", scan: index });
    scan.marks.forEach((mark, question) => {
      if (mark.state === "unclear" && override?.answers?.[question] === undefined) items.push({ kind: "question", scan: index, question, candidates: mark.chosen, state: mark.state });
    });
  });
  return items;
}

export function gradeScan(scan: OmrScan, index: number, key: AnswerKey, penalty: number, override: ScanOverride | undefined): GradedScan {
  const booklet = scanBooklet(scan, override);
  const row = booklet === null ? [] : (key[booklet] ?? []);
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  let graded = 0;
  let pending = 0;
  const questions = scan.marks.map((mark, question): GradedQuestion => {
    const fixed = override?.answers?.[question];
    const chosen = fixed ?? markedChoice(mark);
    const cell = row[question] ?? UNSET;
    const keyOptions = cell.kind === "answer" ? cell.options : [];
    if (booklet === null || cell.kind === "unset") return { chosen: chosen ?? mark.chosen, key: keyOptions, verdict: "void" };
    graded += 1;
    if (cell.kind === "void") {
      correct += 1;
      return { chosen: chosen ?? mark.chosen, key: [], verdict: "void" };
    }
    if (chosen === null) {
      pending += 1;
      blank += 1;
      return { chosen: mark.chosen, key: keyOptions, verdict: "unclear" };
    }
    if (chosen.length === 0) {
      blank += 1;
      return { chosen, key: keyOptions, verdict: "blank" };
    }
    if (chosen.length === 1 && keyOptions.includes(chosen[0])) {
      correct += 1;
      return { chosen, key: keyOptions, verdict: "correct" };
    }
    wrong += 1;
    return { chosen, key: keyOptions, verdict: "wrong" };
  });
  const net = Math.max(0, correct - penalty * wrong);
  const studentId = override?.studentId ?? scan.studentId;
  return { index, scan, studentId, booklet, questions, correct, wrong, blank, graded, net: round(net), percent: graded ? round((net / graded) * 100) : 0, pending };
}

export function gradeAll(scans: readonly OmrScan[], key: AnswerKey, penalty: number, overrides: Overrides): GradedScan[] {
  return scans.map((scan, index) => gradeScan(scan, index, key, penalty, overrides[index]));
}

export type QuestionStat = { booklet: number; question: number; key: number[]; answered: number; correct: number; blank: number; counts: number[] };

export function questionStats(graded: readonly GradedScan[], options: number): QuestionStat[] {
  const stats = new Map<string, QuestionStat>();
  for (const sheet of graded) {
    const booklet = sheet.booklet;
    if (booklet === null) continue;
    sheet.questions.forEach((question, index) => {
      const id = `${booklet}:${index}`;
      const stat = stats.get(id) ?? { booklet, question: index + 1, key: question.key, answered: 0, correct: 0, blank: 0, counts: Array.from({ length: options }, () => 0) };
      stats.set(id, stat);
      if (question.verdict === "void") return;
      stat.answered += 1;
      if (question.verdict === "correct") stat.correct += 1;
      if (question.verdict === "blank" || question.verdict === "unclear") stat.blank += 1;
      if (question.verdict !== "unclear") for (const option of question.chosen) if (option < options) stat.counts[option] += 1;
    });
  }
  return [...stats.values()].sort((first, second) => first.booklet - second.booklet || first.question - second.question);
}

export function sourceLabel(scan: OmrScan, basename: (path: string) => string): string {
  return scan.page === null ? basename(scan.source) : `${basename(scan.source)} · ${scan.page}`;
}

type Texts = {
  student: string;
  source: string;
  booklet: string;
  correct: string;
  wrong: string;
  blank: string;
  net: string;
  percent: string;
  question: string;
  key: string;
  answered: string;
  correctShare: string;
  blankShare: string;
  studentsTitle: string;
  questionsTitle: string;
  basename: (path: string) => string;
};

function answerText(question: GradedQuestion, lowerCase: boolean): string {
  if (question.verdict === "unclear") return "?";
  return question.chosen.map((option) => optionLetter(option, lowerCase)).join("");
}

export function studentsTable(graded: readonly GradedScan[], texts: Texts): OmrTable {
  const questions = Math.max(0, ...graded.map((sheet) => sheet.questions.length));
  const header = [texts.student, texts.source, texts.booklet, texts.correct, texts.wrong, texts.blank, texts.net, texts.percent, ...Array.from({ length: questions }, (_, index) => String(index + 1))];
  const rows = graded.map((sheet) => [
    sheet.studentId,
    sourceLabel(sheet.scan, texts.basename),
    sheet.booklet === null ? "" : bookletLetter(sheet.booklet),
    sheet.correct,
    sheet.wrong,
    sheet.blank,
    sheet.net,
    sheet.percent,
    ...Array.from({ length: questions }, (_, index) => {
      const question = sheet.questions[index];
      return question ? answerText(question, sheet.scan.letterCase === "lower") : "";
    }),
  ]);
  return { title: texts.studentsTitle.slice(0, 31), header, rows };
}

export function questionsTable(stats: readonly QuestionStat[], options: number, texts: Texts): OmrTable {
  const letters = Array.from({ length: options }, (_, index) => optionLetter(index));
  const header = [texts.booklet, texts.question, texts.key, texts.answered, texts.correctShare, texts.blankShare, ...letters];
  const rows = stats.map((stat) => [
    bookletLetter(stat.booklet),
    stat.question,
    stat.key.map((option) => optionLetter(option)).join(""),
    stat.answered,
    stat.answered ? round((stat.correct / stat.answered) * 100) : 0,
    stat.answered ? round((stat.blank / stat.answered) * 100) : 0,
    ...stat.counts,
  ]);
  return { title: texts.questionsTitle.slice(0, 31), header, rows };
}

export function reviewQuestions(sheet: GradedScan): OmrReviewQuestion[] {
  return sheet.questions.map((question) => ({ chosen: question.chosen, key: question.key, verdict: question.verdict }));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mergeOverride(overrides: Overrides, scan: number, change: ScanOverride): Overrides {
  const current = overrides[scan] ?? {};
  return { ...overrides, [scan]: { ...current, ...change, answers: { ...current.answers, ...change.answers } } };
}
