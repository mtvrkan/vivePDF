import type { TableSpec } from "@/types";
import { applyGridEdit, type GridEdit, type GridLimits } from "../grid/gridModel";

export const ANSWER_KEY_LIMITS: GridLimits = { rows: 200, columns: 2, cellChars: 40, minColumns: 2 };
export const ANSWER_KEY_GROUPS = { min: 1, max: 8 } as const;
export const DEFAULT_ANSWER_KEY_FONT = "bundled:dejavu-sans";
const TABLE_BODY_ROWS = 59;

export type AnswerKeySettings = {
  cells: string[][];
  groups: number;
  numberHeader: string;
  answerHeader: string;
  width: number;
  fontSize: number;
  fontId: string;
  color: string;
  borderColor: string;
  headerFill: string | null;
};

export type AnswerKeyLook = Pick<AnswerKeySettings, "groups" | "width" | "fontSize" | "fontId" | "color" | "borderColor" | "headerFill">;

export const DEFAULT_ANSWER_KEY_LOOK: AnswerKeyLook = {
  groups: 4,
  width: 400,
  fontSize: 11,
  fontId: DEFAULT_ANSWER_KEY_FONT,
  color: "#111111",
  borderColor: "#404040",
  headerFill: "#e5e7eb",
};

export function answerKeyLook(settings: AnswerKeySettings): AnswerKeyLook {
  const { groups, width, fontSize, fontId, color, borderColor, headerFill } = settings;
  return { groups, width, fontSize, fontId, color, borderColor, headerFill };
}

export function newAnswerKey(look: AnswerKeyLook, headers: { number: string; answer: string }, entries: ReadonlyArray<[number, string]>): AnswerKeySettings {
  const cells = entries.length ? entries.map(([number, answer]) => [String(number), answer]) : [["", ""]];
  return { ...look, numberHeader: headers.number, answerHeader: headers.answer, cells };
}

export function applyAnswerKeyEdit(settings: AnswerKeySettings, edit: GridEdit): AnswerKeySettings {
  const cells = applyGridEdit(settings.cells, edit, ANSWER_KEY_LIMITS);
  return cells === settings.cells ? settings : { ...settings, cells };
}

export function filledRows(settings: AnswerKeySettings): string[][] {
  return settings.cells.filter(([number, answer]) => number.trim() || answer.trim()).map(([number, answer]) => [number.trim(), answer.trim()]);
}

export function isBlankAnswerKey(settings: AnswerKeySettings): boolean {
  return filledRows(settings).length === 0;
}

export function effectiveGroups(settings: AnswerKeySettings): number {
  const rows = filledRows(settings).length;
  const needed = Math.ceil(rows / TABLE_BODY_ROWS);
  return Math.max(needed, Math.min(settings.groups, Math.max(1, rows)));
}

export function toAnswerKeyTable(settings: AnswerKeySettings): TableSpec {
  const rows = filledRows(settings);
  const groups = effectiveGroups(settings);
  const perGroup = Math.max(1, Math.ceil(rows.length / groups));
  const header = Array.from({ length: groups }, () => [settings.numberHeader, settings.answerHeader]).flat();
  const body = Array.from({ length: perGroup }, (_, row) => Array.from({ length: groups }, (_, group) => rows[group * perGroup + row] ?? ["", ""]).flat());
  return {
    cells: [header, ...body],
    columnWidths: Array.from({ length: groups }, () => [1, 1]).flat(),
    align: Array.from({ length: groups * 2 }, () => "center" as const),
    width: settings.width,
    fontSize: settings.fontSize,
    fontId: settings.fontId,
    header: true,
    border: "all",
    color: settings.color,
    borderColor: settings.borderColor,
    headerFill: settings.headerFill,
    stripes: false,
  };
}
