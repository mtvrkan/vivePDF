import { describe, expect, it } from "vitest";
import { reindentLines } from "./codeReindent";

describe("reindentLines", () => {
  it("reproduces relative indentation from rect x offsets", () => {
    const lines = ["function foo() {", "return 1;", "}"];
    const rects = [
      { x: 100, width: 160 },
      { x: 116, width: 90 },
      { x: 100, width: 10 },
    ];
    expect(reindentLines(lines, rects)).toEqual(["function foo() {", "  return 1;", "}"]);
  });

  it("leaves a single line untouched when no reindent is needed", () => {
    expect(reindentLines(["const x = 1;"], [{ x: 50, width: 120 }])).toEqual(["const x = 1;"]);
  });

  it("falls back to zero indent for zero-width or missing rects without throwing", () => {
    const lines = ["a", "b"];
    const rects = [{ x: 10, width: 0 }, null];
    expect(() => reindentLines(lines, rects)).not.toThrow();
    expect(reindentLines(lines, rects)).toEqual(["a", "b"]);
  });
});
