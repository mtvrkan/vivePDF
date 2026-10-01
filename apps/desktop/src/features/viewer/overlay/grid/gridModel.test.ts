import { describe, expect, it } from "vitest";
import { applyGridEdit, emptyCells, parseClipboardGrid, pasteOverflows, resizeColumnList, type GridLimits } from "./gridModel";

const LIMITS: GridLimits = { rows: 4, columns: 3, cellChars: 5, minColumns: 2 };

describe("parseClipboardGrid", () => {
  it("reads tab-separated rows, quoted cells with line breaks and a trailing newline", () => {
    expect(parseClipboardGrid('Name\tNote\r\nAda\t"line one\nline ""two"""\r\n')).toEqual([
      ["Name", "Note"],
      ["Ada", 'line one\nline "two"'],
    ]);
    expect(parseClipboardGrid("a\nb\nc")).toEqual([["a"], ["b"], ["c"]]);
    expect(parseClipboardGrid("x\ty")).toEqual([["x", "y"]]);
  });

  it("leaves ordinary one-line text to the input", () => {
    expect(parseClipboardGrid("just text")).toBeNull();
    expect(parseClipboardGrid("one line\n")).toBeNull();
  });
});

describe("applyGridEdit", () => {
  it("cuts cell text at the limit and keeps other cells", () => {
    expect(applyGridEdit([["a", "b"]], { kind: "setCell", row: 0, column: 1, text: "abcdefgh" }, LIMITS)).toEqual([["a", "abcde"]]);
  });

  it("returns the same grid when an edit would break a limit", () => {
    const full = emptyCells(4, 3);
    expect(applyGridEdit(full, { kind: "addRow" }, LIMITS)).toBe(full);
    expect(applyGridEdit(full, { kind: "addColumn" }, LIMITS)).toBe(full);
    const narrow = emptyCells(1, 2);
    expect(applyGridEdit(narrow, { kind: "removeColumn", column: 0 }, LIMITS)).toBe(narrow);
    expect(applyGridEdit(narrow, { kind: "removeRow", row: 0 }, LIMITS)).toBe(narrow);
  });

  it("pastes from the chosen cell, growing up to the limits", () => {
    const pasted = applyGridEdit([["a", "b"]], { kind: "paste", row: 0, column: 1, grid: [["1", "2", "3"], ["4"]] }, LIMITS);
    expect(pasted).toEqual([
      ["a", "1", "2"],
      ["", "4", ""],
    ]);
    expect(pasteOverflows(0, 1, [["1", "2", "3"]], LIMITS)).toBe(true);
    expect(pasteOverflows(0, 0, [["1", "2", "3"]], LIMITS)).toBe(false);
  });
});

describe("resizeColumnList", () => {
  it("follows added and removed columns, with an offset for a leading label column", () => {
    const cells = [["", "a", "b", "c"]];
    expect(resizeColumnList(["x", "y"], cells, { kind: "addColumn", at: 2 }, () => "new", 1)).toEqual(["x", "new", "y"]);
    expect(resizeColumnList(["x", "y", "z", "w"], [["", "a", "b", "c"]], { kind: "removeColumn", column: 2 }, () => "new", 1)).toEqual(["x", "z", "w"]);
    expect(resizeColumnList(["x"], cells, { kind: "paste", row: 0, column: 0, grid: [] }, (index) => `fill${index}`, 1)).toEqual(["x", "fill1", "fill2"]);
  });
});
