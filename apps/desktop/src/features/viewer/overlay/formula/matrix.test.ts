import { describe, expect, it } from "vitest";
import { typeset } from "./mathjaxEngine";
import { clampMatrixSize, MATRIX_BRACKETS, MATRIX_FILLS, matrixLatex } from "./matrix";

describe("matrixLatex", () => {
  it("writes indexed entries row by row in the chosen brackets", () => {
    expect(matrixLatex({ rows: 2, columns: 3, bracket: "bracket", fill: "entries", letter: "a" })).toBe(String.raw`\begin{bmatrix}
a_{11} & a_{12} & a_{13} \\
a_{21} & a_{22} & a_{23}
\end{bmatrix}`);
  });

  it("fills zeros, an identity diagonal or empty cells", () => {
    expect(matrixLatex({ rows: 2, columns: 2, bracket: "paren", fill: "identity", letter: "a" })).toBe(String.raw`\begin{pmatrix}
1 & 0 \\
0 & 1
\end{pmatrix}`);
    expect(matrixLatex({ rows: 1, columns: 2, bracket: "none", fill: "zeros", letter: "a" })).toContain("0 & 0");
    expect(matrixLatex({ rows: 2, columns: 2, bracket: "bar", fill: "empty", letter: "a" })).toBe(String.raw`\begin{vmatrix}
 & \\
 &
\end{vmatrix}`);
  });

  it("separates two-digit indices with a comma and keeps the letter safe", () => {
    const big = matrixLatex({ rows: 10, columns: 2, bracket: "paren", fill: "entries", letter: "B" });
    expect(big).toContain("B_{10,2}");
    expect(big).toContain("B_{1,1}");
    expect(matrixLatex({ rows: 1, columns: 1, bracket: "paren", fill: "entries", letter: "}\\x" })).toContain("a_{11}");
  });

  it("keeps the size between 1 and 10", () => {
    expect(clampMatrixSize(0)).toBe(1);
    expect(clampMatrixSize(99)).toBe(10);
    expect(clampMatrixSize(Number.NaN)).toBe(1);
    expect(clampMatrixSize(3.6)).toBe(4);
  });

  it("typesets every bracket and fill", async () => {
    const failures: string[] = [];
    for (const bracket of MATRIX_BRACKETS) {
      for (const fill of MATRIX_FILLS) {
        const latex = matrixLatex({ rows: 3, columns: 3, bracket, fill, letter: "x" });
        const result = await typeset(latex);
        if ("error" in result) failures.push(`${bracket} ${fill}: ${result.error}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
