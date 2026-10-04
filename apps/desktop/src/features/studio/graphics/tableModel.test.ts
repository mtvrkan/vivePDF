import { describe, expect, it } from "vitest";
import {
  TABLE_LIMITS,
  TABLE_STYLES,
  cellAlign,
  cellBold,
  cellFill,
  clearRange,
  columnCount,
  createTableData,
  distributeColumns,
  insertColumn,
  insertRow,
  matchingTableStyle,
  moveColumnBorder,
  neighbour,
  normalizeTableData,
  pasteGrid,
  rangeSize,
  removeColumn,
  removeRow,
  setCellText,
  setColumnWidth,
  styleRange,
  tableGeometry,
} from "./tableModel";

const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

function filled() {
  let data = createTableData(3, 3);
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) data = setCellText(data, { row, column }, `${row}${column}`);
  return data;
}

describe("studio table model", () => {
  it("creates an empty grid with even columns and one style per cell", () => {
    const data = createTableData(4, 5);

    expect(data.cells).toHaveLength(4);
    expect(columnCount(data)).toBe(5);
    expect(data.styles.every((row) => row.length === 5)).toBe(true);
    expect(data.columns).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(matchingTableStyle(data)).toBe("classic");
  });

  it("clamps the size to the engine limits", () => {
    const data = createTableData(500, 0);

    expect(data.cells).toHaveLength(TABLE_LIMITS.rows);
    expect(columnCount(data)).toBe(1);
  });

  it("inserts and removes rows while keeping cells and styles together", () => {
    let data = styleRange(filled(), { anchor: { row: 1, column: 0 }, focus: { row: 1, column: 0 } }, { fill: "#ff0000" });

    data = insertRow(data, 2);
    expect(data.cells.map((row) => row[0])).toEqual(["00", "10", "", "20"]);
    expect(data.styles[2][0]).toEqual({ fill: "#ff0000" });

    data = removeRow(data, 1);
    expect(data.cells.map((row) => row[0])).toEqual(["00", "", "20"]);
    expect(data.styles).toHaveLength(3);
  });

  it("does not copy the header look into a new first row and keeps the last row", () => {
    const styled = styleRange(filled(), { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 2 } }, { bold: true });

    expect(insertRow(styled, 0).styles[0]).toEqual([{}, {}, {}]);
    expect(removeRow(createTableData(1, 2), 0).cells).toHaveLength(1);
  });

  it("inserts and removes columns and renormalises the widths", () => {
    let data = insertColumn(filled(), 1);

    expect(data.cells[0]).toEqual(["00", "", "01", "02"]);
    expect(total(data.columns)).toBeCloseTo(1);
    expect(data.align).toHaveLength(4);

    data = removeColumn(data, 0);
    expect(data.cells[0]).toEqual(["", "01", "02"]);
    expect(total(data.columns)).toBeCloseTo(1);
    expect(removeColumn(createTableData(2, 1), 0).cells[0]).toHaveLength(1);
  });

  it("moves a column border between its two neighbours only", () => {
    const data = moveColumnBorder(createTableData(2, 3), 0, 30, 300);

    expect(data.columns[0] * 300).toBeCloseTo(130);
    expect(data.columns[1] * 300).toBeCloseTo(70);
    expect(data.columns[2] * 300).toBeCloseTo(100);
  });

  it("stops a dragged border at the minimum column width", () => {
    const data = moveColumnBorder(createTableData(2, 2), 0, -1000, 200);

    expect(data.columns[0] * 200).toBeCloseTo(12);
    expect(total(data.columns)).toBeCloseTo(1);
    expect(moveColumnBorder(data, 5, 10, 200)).toBe(data);
  });

  it("sets one column width by growing the table and can even them out again", () => {
    const result = setColumnWidth(createTableData(2, 2), 1, 150, 200);

    expect(result.width).toBeCloseTo(250);
    expect(result.data.columns[1] * result.width).toBeCloseTo(150);
    expect(distributeColumns(result.data).columns).toEqual([0.5, 0.5]);
  });

  it("pastes a spreadsheet block and grows the table to fit", () => {
    const data = pasteGrid(createTableData(2, 2), { row: 1, column: 1 }, [["a", "b"], ["c", "d"]]);

    expect(data.cells).toEqual([["", "", ""], ["", "a", "b"], ["", "c", "d"]]);
    expect(data.styles).toHaveLength(3);
    expect(total(data.columns)).toBeCloseTo(1);
  });

  it("styles a range of cells and removes a style with null", () => {
    const range = { anchor: { row: 2, column: 2 }, focus: { row: 1, column: 1 } };
    let data = styleRange(filled(), range, { align: "right", bold: true, color: "#123456" });

    expect(cellAlign(data, { row: 1, column: 1 })).toBe("right");
    expect(cellAlign(data, { row: 0, column: 1 })).toBe("left");
    expect(cellBold(data, { row: 2, column: 2 })).toBe(true);

    data = styleRange(data, range, { bold: null });
    expect(data.styles[2][2]).toEqual({ align: "right", color: "#123456" });
  });

  it("reports the header, stripe and own cell fills in order of priority", () => {
    const data = { ...createTableData(4, 1), stripes: true, stripeFill: "#eeeeee", headerFill: "#cccccc" };
    const own = styleRange(data, { anchor: { row: 3, column: 0 }, focus: { row: 3, column: 0 } }, { fill: "#00ff00" });

    expect(cellFill(own, { row: 0, column: 0 })).toBe("#cccccc");
    expect(cellFill(own, { row: 1, column: 0 })).toBeNull();
    expect(cellFill(own, { row: 2, column: 0 })).toBe("#eeeeee");
    expect(cellFill(own, { row: 3, column: 0 })).toBe("#00ff00");
  });

  it("navigates with tab order and stops at the edges", () => {
    const data = filled();

    expect(neighbour(data, { row: 0, column: 2 }, "next")).toEqual({ row: 1, column: 0 });
    expect(neighbour(data, { row: 1, column: 0 }, "previous")).toEqual({ row: 0, column: 2 });
    expect(neighbour(data, { row: 2, column: 2 }, "next")).toBeNull();
    expect(neighbour(data, { row: 0, column: 0 }, "previous")).toBeNull();
    expect(neighbour(data, { row: 0, column: 1 }, "up")).toBeNull();
    expect(neighbour(data, { row: 0, column: 1 }, "down")).toEqual({ row: 1, column: 1 });
    expect(neighbour(data, { row: 1, column: 0 }, "left")).toBeNull();
    expect(neighbour(data, { row: 1, column: 2 }, "right")).toBeNull();
  });

  it("clears every cell of a range", () => {
    const range = { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } };
    const data = clearRange(filled(), range);

    expect(rangeSize(range)).toBe(4);
    expect(data.cells).toEqual([["", "", "02"], ["", "", "12"], ["20", "21", "22"]]);
  });

  it("places cells from the rendered layout and falls back to even rows", () => {
    const data = { ...createTableData(2, 2), layout: { width: 100, height: 40, rows: [10, 30], columns: [50, 50] } };

    expect(tableGeometry(data, 200, 80)).toEqual({ columns: [0, 100, 200], rows: [0, 20, 80] });
    expect(tableGeometry({ ...data, layout: null }, 200, 80).rows).toEqual([0, 40, 80]);
  });

  it("reads saved tables defensively", () => {
    const data = normalizeTableData({ kind: "table", cells: [["a"], ["b", "c", 4]], styles: [[{ fill: "red", bold: true }]], columns: [1, -2], border: "dotted", borderColor: "#ABCDEF", fontSize: "big" });

    expect(data?.cells).toEqual([["a", "", ""], ["b", "c", ""]]);
    expect(data?.styles[0][0]).toEqual({ bold: true });
    expect(data?.border).toBe("all");
    expect(data?.borderColor).toBe("#abcdef");
    expect(data?.fontSize).toBe(12);
    expect(total(data?.columns ?? [])).toBeCloseTo(1);
    expect(normalizeTableData({ kind: "chart", cells: [["a"]] })).toBeNull();
    expect(normalizeTableData({ kind: "table", cells: [] })).toBeNull();
    expect(normalizeTableData(null)).toBeNull();
  });

  it("recognises a preset look and loses it after a change", () => {
    const blue = { ...createTableData(2, 2), ...TABLE_STYLES.blue };

    expect(matchingTableStyle(blue)).toBe("blue");
    expect(matchingTableStyle({ ...blue, borderWidth: 3 })).toBeNull();
  });
});
