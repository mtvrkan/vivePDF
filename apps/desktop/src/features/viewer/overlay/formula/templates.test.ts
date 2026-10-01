import { describe, expect, it } from "vitest";
import { typeset } from "./mathjaxEngine";
import { FORMULA_TEMPLATES, insertAt } from "./templates";

describe("FORMULA_TEMPLATES", () => {
  it("typesets every template without a LaTeX error", async () => {
    const failures: string[] = [];
    for (const group of FORMULA_TEMPLATES) {
      for (const latex of group.items) {
        const result = await typeset(latex);
        if ("error" in result) failures.push(`${latex}: ${result.error}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("has unique group ids and no repeated template", () => {
    const ids = FORMULA_TEMPLATES.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    const all = FORMULA_TEMPLATES.flatMap((group) => group.items);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("insertAt", () => {
  it("replaces the selection and puts the caret after the insertion", () => {
    expect(insertAt("a + b", String.raw`\times`, 2, 3)).toEqual({ text: String.raw`a \times b`, caret: 8 });
  });

  it("keeps a letter from gluing onto the command before it", () => {
    expect(insertAt(String.raw`\pi`, "r^2", 3, 3)).toEqual({ text: String.raw`\pi r^2`, caret: 7 });
    expect(insertAt(String.raw`\alpha`, String.raw`\beta`, 6, 6).text).toBe(String.raw`\alpha\beta`);
  });

  it("clamps a caret that is out of range", () => {
    expect(insertAt("x", "y", 10, 20)).toEqual({ text: "x y", caret: 3 });
    expect(insertAt("", String.raw`\frac{a}{b}`, -4, -1)).toEqual({ text: String.raw`\frac{a}{b}`, caret: 11 });
  });
});
