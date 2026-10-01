import { describe, expect, it } from "vitest";
import { emptyCells } from "../grid/gridModel";
import { DEFAULT_TABLE, TABLE_LIMITS, TABLE_STYLES, applyStyle, applyTableEdit, columnWeights, freshTable, isBlankTable, matchingStyle, setAlign, tableLook, toTableSpec, type TableSettings } from "./tableModel";

function table(cells: string[][]): TableSettings {
  return { ...DEFAULT_TABLE, cells, align: cells[0].map(() => "left") };
}

describe("table editing", () => {
  it("adds and removes rows and columns while keeping every row the same width", () => {
    let settings = table([["a", "b"], ["c", "d"]]);
    settings = applyTableEdit(settings, { kind: "addColumn", at: 1 });
    expect(settings.cells).toEqual([["a", "", "b"], ["c", "", "d"]]);
    expect(settings.align).toHaveLength(3);
    settings = applyTableEdit(settings, { kind: "addRow", at: 0 });
    expect(settings.cells[0]).toEqual(["", "", ""]);
    settings = applyTableEdit(applyTableEdit(settings, { kind: "removeRow", row: 0 }), { kind: "removeColumn", column: 0 });
    expect(settings.cells).toEqual([["", "b"], ["", "d"]]);
    expect(settings.align).toHaveLength(2);
  });

  it("keeps each column's alignment with its column when columns come and go", () => {
    let settings = setAlign(setAlign(table([["a", "b", "c"]]), 0, "right"), 2, "center");
    settings = applyTableEdit(settings, { kind: "removeColumn", column: 1 });
    expect(settings.align).toEqual(["right", "center"]);
    settings = applyTableEdit(settings, { kind: "addColumn", at: 1 });
    expect(settings.align).toEqual(["right", "left", "center"]);
  });

  it("never removes the last row or column and never grows past the limits", () => {
    const single = table([["x"]]);
    expect(applyTableEdit(single, { kind: "removeRow", row: 0 })).toBe(single);
    expect(applyTableEdit(single, { kind: "removeColumn", column: 0 })).toBe(single);
    const full = table(emptyCells(TABLE_LIMITS.rows, TABLE_LIMITS.columns));
    expect(applyTableEdit(full, { kind: "addRow" })).toBe(full);
    expect(applyTableEdit(full, { kind: "addColumn" })).toBe(full);
  });

  it("changes one cell and one column's alignment only", () => {
    const settings = setAlign(applyTableEdit(table([["a", "b"], ["c", "d"]]), { kind: "setCell", row: 1, column: 0, text: "z" }), 1, "right");
    expect(settings.cells).toEqual([["a", "b"], ["z", "d"]]);
    expect(settings.align).toEqual(["left", "right"]);
  });

  it("knows when nothing has been typed", () => {
    expect(isBlankTable(table([[" ", ""], ["", "\n"]]))).toBe(true);
    expect(isBlankTable(table([["", ""], ["", "x"]]))).toBe(false);
  });
});

describe("pasting from a spreadsheet", () => {
  it("fills from the chosen cell, grows the table and its alignments, and cuts at the limits", () => {
    const grown = applyTableEdit(table([["a", "b"], ["c", "d"]]), { kind: "paste", row: 1, column: 1, grid: [["1", "2"], ["3", "4"]] });
    expect(grown.cells).toEqual([["a", "b", ""], ["c", "1", "2"], ["", "3", "4"]]);
    expect(grown.align).toHaveLength(3);
    const huge = Array.from({ length: TABLE_LIMITS.rows + 5 }, () => Array.from({ length: TABLE_LIMITS.columns + 5 }, () => "x"));
    const capped = applyTableEdit(table([["a"]]), { kind: "paste", row: 0, column: 0, grid: huge });
    expect(capped.cells).toHaveLength(TABLE_LIMITS.rows);
    expect(capped.cells[0]).toHaveLength(TABLE_LIMITS.columns);
    expect(capped.align).toHaveLength(TABLE_LIMITS.columns);
  });
});

describe("table look", () => {
  it("applies a style and recognises it again, and forgets it after a colour change", () => {
    const blue = TABLE_STYLES.find((style) => style.id === "blue");
    if (!blue) throw new Error("no blue style");
    const styled = applyStyle(DEFAULT_TABLE, blue);
    expect(matchingStyle(styled)).toBe("blue");
    expect(matchingStyle({ ...styled, color: "#123456" })).toBeNull();
  });

  it("starts a new table with the last look but empty cells", () => {
    const look = tableLook({ ...DEFAULT_TABLE, cells: [["kept?"]], align: ["right"], fontSize: 14 });
    const fresh = freshTable(look);
    expect(fresh.fontSize).toBe(14);
    expect(isBlankTable(fresh)).toBe(true);
    expect(fresh.align).toEqual(DEFAULT_TABLE.align);
  });

  it("sizes columns equally or by their longest line", () => {
    const settings = table([["Name", "A somewhat longer heading"], ["x", "y"]]);
    expect(columnWeights(settings)).toEqual([1, 1]);
    expect(columnWeights({ ...settings, widthMode: "fit" })).toEqual([4, 25]);
    expect(columnWeights({ ...table([["", "x".repeat(90)]]), widthMode: "fit" })).toEqual([3, 40]);
  });

  it("sends only what the sidecar reads", () => {
    const spec = toTableSpec(DEFAULT_TABLE);
    expect(Object.keys(spec).sort()).toEqual(["align", "border", "borderColor", "cells", "color", "columnWidths", "fontId", "fontSize", "header", "headerFill", "stripes", "width"]);
  });
});
