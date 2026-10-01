import { describe, expect, it } from "vitest";
import { MM, PAPER_STYLES, paperMarks } from "./paperPattern";

const A4: [number, number] = [595, 842];

describe("paperMarks", () => {
  it("rules lined paper every step with a margin line, like the engine", () => {
    const marks = paperMarks(...A4, { style: "lined", spacing: 8, color: "#000000", margin: true });
    const rules = marks.lines.filter((line) => line.kind === "rule");
    expect(rules).toHaveLength(Math.floor((842 - 20 * MM) / (8 * MM)));
    expect(rules[1].y0 - rules[0].y0).toBeCloseTo(8 * MM);
    expect(marks.lines.filter((line) => line.kind === "margin").map((line) => line.x0)).toEqual([expect.closeTo(30 * MM)]);
  });

  it("centres the grid and puts a dot on every grid crossing", () => {
    const grid = paperMarks(...A4, { style: "grid", spacing: 5, color: "#000000" });
    const dots = paperMarks(...A4, { style: "dots", spacing: 5, color: "#000000" });
    const verticals = grid.lines.filter((line) => line.x0 === line.x1);
    const horizontals = grid.lines.filter((line) => line.y0 === line.y1);
    expect(dots.dots).toHaveLength(verticals.length * horizontals.length);
    expect(verticals[0].x0).toBeCloseTo(595 - verticals[verticals.length - 1].x0);
  });

  it("dashes the two middle lines of each handwriting band", () => {
    const kinds = paperMarks(...A4, { style: "handwriting", spacing: 4, color: "#000000" }).lines.map((line) => line.kind);
    expect(kinds.length % 4).toBe(0);
    expect(kinds.slice(0, 4)).toEqual(["rule", "guide", "guide", "rule"]);
  });

  it("offsets every other isometric row by half a step", () => {
    const marks = paperMarks(...A4, { style: "isometric", spacing: 6, color: "#000000" });
    const [first, second] = [...new Set(marks.dots.map(([, y]) => y))].slice(0, 2).map((y) => marks.dots.filter(([, rowY]) => rowY === y).map(([x]) => x));
    expect(second[0] - first[0]).toBeCloseTo(3 * MM);
    expect(first.length).toBe(second.length + 1);
  });

  it("draws nothing on a page smaller than one step", () => {
    for (const style of PAPER_STYLES) {
      const marks = paperMarks(40, 40, { style, spacing: 30, color: "#000000" });
      expect(marks.lines.length + marks.dots.length).toBe(0);
    }
  });
});
