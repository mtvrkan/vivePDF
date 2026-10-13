import { describe, expect, it } from "vitest";
import { cleanMermaid, errorLine, MAX_MERMAID_CHARS, MERMAID_POINTS_PER_UNIT, MERMAID_TEMPLATES, mermaidTheme, mermaidTitle, placedScale } from "./mermaidModel";

describe("mermaid model", () => {
  it("tidies line endings and outer space and caps the code length", () => {
    expect(cleanMermaid("  flowchart TD\r\n  A --> B\r ")).toBe("flowchart TD\n  A --> B");
    expect(cleanMermaid("x".repeat(MAX_MERMAID_CHARS + 50))).toHaveLength(MAX_MERMAID_CHARS);
  });

  it("names a diagram by its title line, else by its first line, skipping comments", () => {
    expect(mermaidTitle("gantt\n  title Release plan\n  section A")).toBe("Release plan");
    expect(mermaidTitle('pie title "Pets owned"\n "Dogs" : 3')).toBe("Pets owned");
    expect(mermaidTitle("%% draft\nflowchart   LR\n A --> B")).toBe("flowchart LR");
    expect(mermaidTitle("   ")).toBe("");
  });

  it("finds the line number in a parser message", () => {
    expect(errorLine("Parse error on line 3:\n...")).toBe(3);
    expect(errorLine("Lexical error")).toBeNull();
  });

  it("falls back to the default theme for unknown names", () => {
    expect(mermaidTheme("forest")).toBe("forest");
    expect(mermaidTheme("neon")).toBe("default");
    expect(mermaidTheme(undefined)).toBe("default");
  });

  it("places small diagrams at their natural size and shrinks large ones to fit a page", () => {
    expect(placedScale(200, 100)).toBe(MERMAID_POINTS_PER_UNIT);
    expect(placedScale(1600, 100)).toBeCloseTo(480 / 1600);
    expect(placedScale(100, 2000)).toBeCloseTo(680 / 2000);
  });

  it("offers one template per diagram kind, each already tidy", () => {
    expect(MERMAID_TEMPLATES.map((template) => template.id)).toEqual(["flowchart", "sequence", "class", "er", "state", "gantt", "pie", "mindmap"]);
    expect(MERMAID_TEMPLATES.every((template) => cleanMermaid(template.code) === template.code)).toBe(true);
  });
});
