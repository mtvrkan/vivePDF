export const MATRIX_BRACKETS = ["paren", "bracket", "bar", "double", "brace", "none"] as const;
export type MatrixBracket = (typeof MATRIX_BRACKETS)[number];
export const MATRIX_FILLS = ["entries", "zeros", "identity", "empty"] as const;
export type MatrixFill = (typeof MATRIX_FILLS)[number];
export type MatrixSpec = { rows: number; columns: number; bracket: MatrixBracket; fill: MatrixFill; letter: string };

export const MAX_MATRIX_SIZE = 10;

const ENVIRONMENTS: Record<MatrixBracket, string> = {
  paren: "pmatrix",
  bracket: "bmatrix",
  bar: "vmatrix",
  double: "Vmatrix",
  brace: "Bmatrix",
  none: "matrix",
};

export function clampMatrixSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_MATRIX_SIZE, Math.max(1, Math.round(value)));
}

function safeLetter(letter: string): string {
  return /^[A-Za-z]$/.test(letter) ? letter : "a";
}

function cell(spec: MatrixSpec, row: number, column: number): string {
  switch (spec.fill) {
    case "entries": {
      const index = spec.rows > 9 || spec.columns > 9 ? `${row},${column}` : `${row}${column}`;
      return `${safeLetter(spec.letter)}_{${index}}`;
    }
    case "zeros":
      return "0";
    case "identity":
      return row === column ? "1" : "0";
    case "empty":
      return "";
  }
}

export function matrixLatex(spec: MatrixSpec): string {
  const rows = clampMatrixSize(spec.rows);
  const columns = clampMatrixSize(spec.columns);
  const sized = { ...spec, rows, columns };
  const environment = ENVIRONMENTS[spec.bracket];
  const body = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => cell(sized, row + 1, column + 1)).join(" & ").trimEnd()).join(" \\\\\n");
  return `\\begin{${environment}}\n${body}\n\\end{${environment}}`;
}
