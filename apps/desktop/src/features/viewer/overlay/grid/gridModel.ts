export type GridLimits = { rows: number; columns: number; cellChars: number; minColumns: number };

export type GridEdit =
  | { kind: "setCell"; row: number; column: number; text: string }
  | { kind: "addRow"; at?: number }
  | { kind: "removeRow"; row: number }
  | { kind: "addColumn"; at?: number }
  | { kind: "removeColumn"; column: number }
  | { kind: "paste"; row: number; column: number; grid: string[][] };

export function emptyCells(rows: number, columns: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => ""));
}

export function gridColumns(cells: string[][]): number {
  return cells[0]?.length ?? 0;
}

export function parseClipboardGrid(text: string): string[][] | null {
  if (!text.includes("\t") && !/\r?\n./.test(text.trimEnd())) return null;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let index = 0;
  let quoted = false;
  let fieldStart = true;
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 2;
        continue;
      }
      if (char === '"') {
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }
    if (fieldStart && char === '"') {
      quoted = true;
      fieldStart = false;
      index += 1;
      continue;
    }
    fieldStart = false;
    if (char === "\t") {
      row.push(cell);
      cell = "";
      fieldStart = true;
    } else if (char === "\n" || char === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      fieldStart = true;
      if (char === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      cell += char;
    }
    index += 1;
  }
  if (!fieldStart || cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

export function pasteOverflows(row: number, column: number, grid: string[][], limits: GridLimits): boolean {
  const widest = Math.max(...grid.map((cells) => cells.length));
  return row + grid.length > limits.rows || column + widest > limits.columns;
}

export function applyGridEdit(cells: string[][], edit: GridEdit, limits: GridLimits): string[][] {
  const columns = gridColumns(cells);
  switch (edit.kind) {
    case "setCell":
      return cells.map((row, index) => (index === edit.row ? row.map((value, position) => (position === edit.column ? edit.text.slice(0, limits.cellChars) : value)) : row));
    case "addRow": {
      if (cells.length >= limits.rows) return cells;
      const next = [...cells];
      next.splice(edit.at ?? cells.length, 0, Array.from({ length: columns }, () => ""));
      return next;
    }
    case "removeRow":
      return cells.length <= 1 ? cells : cells.filter((_, index) => index !== edit.row);
    case "addColumn": {
      if (columns >= limits.columns) return cells;
      const at = edit.at ?? columns;
      return cells.map((row) => [...row.slice(0, at), "", ...row.slice(at)]);
    }
    case "removeColumn":
      return columns <= limits.minColumns ? cells : cells.map((row) => row.filter((_, index) => index !== edit.column));
    case "paste": {
      const width = Math.max(...edit.grid.map((row) => row.length));
      const rows = Math.min(limits.rows, Math.max(cells.length, edit.row + edit.grid.length));
      const wide = Math.min(limits.columns, Math.max(columns, edit.column + width));
      return Array.from({ length: rows }, (_, rowIndex) =>
        Array.from({ length: wide }, (_, columnIndex) => {
          const pasted = edit.grid[rowIndex - edit.row]?.[columnIndex - edit.column];
          return pasted !== undefined ? pasted.slice(0, limits.cellChars) : (cells[rowIndex]?.[columnIndex] ?? "");
        }),
      );
    }
  }
}

export function resizeColumnList<T>(list: T[], cells: string[][], edit: GridEdit, filler: (index: number) => T, offset = 0): T[] {
  const wanted = Math.max(0, gridColumns(cells) - offset);
  if (edit.kind === "addColumn" && list.length < wanted) {
    const at = Math.max(0, (edit.at ?? list.length + offset) - offset);
    const next = [...list];
    next.splice(at, 0, filler(at));
    return next;
  }
  if (edit.kind === "removeColumn" && list.length > wanted) return list.filter((_, index) => index !== edit.column - offset);
  if (list.length === wanted) return list;
  return Array.from({ length: wanted }, (_, index) => list[index] ?? filler(index));
}
