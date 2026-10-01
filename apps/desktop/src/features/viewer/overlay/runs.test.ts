import { describe, expect, it } from "vitest";
import { applyTextEdit, flattenLines, hasMixedStyles, mergeRuns, rangeIsBold, rangeIsItalic, restoreOriginalRunStyles, sameRuns, setStyleRange, textOf, type Run, type RunStyle } from "./runs";

const PLAIN: RunStyle = { font: "helv", fontXref: 0, size: 12, color: "#111111", bold: false, italic: false, superscript: false };
const BOLD: RunStyle = { font: "helv", fontXref: 0, size: 12, color: "#111111", bold: true, italic: false, superscript: false };

function runs(...parts: Array<[string, RunStyle]>): Run[] {
  return parts.map(([text, style]) => ({ ...style, text }));
}

describe("applyTextEdit", () => {
  it("inserts text in the middle of a bold run using the bold style", () => {
    const original = runs(["hello ", PLAIN], ["world", BOLD]);
    const next = applyTextEdit(original, "hello wonderful world", PLAIN);
    expect(textOf(next)).toBe("hello wonderful world");
    const inserted = next.find((run) => run.text.includes("nderful"));
    expect(inserted?.bold).toBe(true);
  });

  it("deletes text spanning across two runs", () => {
    const original = runs(["hello ", PLAIN], ["world", BOLD]);
    const next = applyTextEdit(original, "held", PLAIN);
    expect(textOf(next)).toBe("held");
  });

  it("replaces the whole text with a single run inheriting the first run's style", () => {
    const original = runs(["hello ", PLAIN], ["world", BOLD]);
    const next = applyTextEdit(original, "totally new copy", PLAIN);
    expect(textOf(next)).toBe("totally new copy");
    expect(next).toHaveLength(1);
    expect(next[0].bold).toBe(false);
  });

  it("appends text at the end inheriting the last run's style", () => {
    const original = runs(["hello ", PLAIN], ["world", BOLD]);
    const next = applyTextEdit(original, "hello world!", PLAIN);
    const tail = next[next.length - 1];
    expect(tail.text.endsWith("!")).toBe(true);
    expect(tail.bold).toBe(true);
  });

  it("prepends text at the start inheriting the first run's style", () => {
    const original = runs(["hello ", PLAIN], ["world", BOLD]);
    const next = applyTextEdit(original, ">> hello world", PLAIN);
    expect(next[0].text.startsWith(">> ")).toBe(true);
    expect(next[0].bold).toBe(false);
  });

  it("returns the same runs when the text is unchanged", () => {
    const original = runs(["hello", PLAIN]);
    const next = applyTextEdit(original, "hello", PLAIN);
    expect(next).toBe(original);
  });

  it("falls back to the provided style when editing an empty block", () => {
    const next = applyTextEdit([], "new text", BOLD);
    expect(textOf(next)).toBe("new text");
    expect(next[0].bold).toBe(true);
  });
});

describe("mixed-run style safety", () => {
  const BOLD_COLON: RunStyle = { font: "helv", fontXref: 0, size: 12, color: "#111111", bold: true, italic: false, superscript: false };
  const ITALIC_B: RunStyle = { font: "helv", fontXref: 0, size: 12, color: "#111111", bold: false, italic: true, superscript: false };

  it("typing at the end keeps both original runs and appends the new character to the italic run", () => {
    const original = runs(["A:", BOLD_COLON], [" b", ITALIC_B]);
    const next = applyTextEdit(original, "A: bx", PLAIN);
    expect(textOf(next)).toBe("A: bx");
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ text: "A:", bold: true, italic: false });
    expect(next[1]).toMatchObject({ text: " bx", bold: false, italic: true });
  });

  it("toggling bold on a selected range only changes that range", () => {
    const original = runs(["A:", BOLD_COLON], [" b", ITALIC_B]);
    const from = "A:".length;
    const to = "A: b".length;
    const next = setStyleRange(original, from, to, { bold: !rangeIsBold(original, from, to) });
    expect(textOf(next)).toBe("A: b");
    expect(next.find((run) => run.text === "A:")?.bold).toBe(true);
    const changed = next.find((run) => run.text === " b");
    expect(changed?.bold).toBe(true);
    expect(changed?.italic).toBe(true);
  });

  it("rangeIsItalic reports false when the range mixes italic and non-italic runs", () => {
    const original = runs(["A:", BOLD_COLON], [" b", ITALIC_B]);
    expect(rangeIsItalic(original, 0, textOf(original).length)).toBe(false);
  });
});

describe("mergeRuns", () => {
  it("merges adjacent runs sharing the same style", () => {
    const merged = mergeRuns(runs(["foo", PLAIN], ["bar", PLAIN], ["baz", BOLD]));
    expect(merged).toHaveLength(2);
    expect(merged[0].text).toBe("foobar");
  });
});

describe("flattenLines", () => {
  const run = (text: string, bold = false) => ({ text, font: "F", fontXref: 1, fontFamily: "F", size: 10, color: "#000", bold, italic: false, superscript: false });
  it("keeps hard breaks as newlines and joins soft breaks with spaces", () => {
    const lines = [
      { text: "A: one", bbox: [0, 0, 10, 10], runs: [run("A:", true), run(" one")], hardBreak: true },
      { text: "B: two", bbox: [0, 0, 10, 10], runs: [run("B:", true), run(" two")], hardBreak: false },
      { text: "three", bbox: [0, 0, 10, 10], runs: [run("three")] },
    ];
    const runs = flattenLines(lines);
    expect(textOf(runs)).toBe("A: one\nB: two three");
    expect(runs.filter((item) => item.bold).map((item) => item.text)).toEqual(["A:", "B:"]);
  });
  it("removes soft-wrap hyphens", () => {
    const lines = [
      { text: "wrapped-", bbox: [0, 0, 10, 10], runs: [run("wrapped-")], hardBreak: false },
      { text: "line", bbox: [0, 0, 10, 10], runs: [run("line")] },
    ];
    expect(textOf(flattenLines(lines))).toBe("wrappedline");
  });
});

describe("restoreOriginalRunStyles", () => {
  const RED: RunStyle = { ...PLAIN, color: "#cc0000" };

  it("gives back the original runs when the text is unchanged", () => {
    const original = runs(["Merhaba ", PLAIN], ["dünya", BOLD]);
    const edited = runs(["Merhaba dünya", { ...PLAIN, size: 20, color: "#00aa00" }]);
    expect(sameRuns(restoreOriginalRunStyles(edited, original, PLAIN), original)).toBe(true);
  });

  it("keeps the edited text and puts every original style back around it", () => {
    const original = runs(["Merhaba ", PLAIN], ["dünya", BOLD], [" sonu", RED]);
    const edited = runs(["Merhaba güzel dünya sonu", { ...PLAIN, size: 30 }]);
    const restored = restoreOriginalRunStyles(edited, original, PLAIN);
    expect(textOf(restored)).toBe("Merhaba güzel dünya sonu");
    expect(restored.find((run) => run.text.includes("dünya"))?.bold).toBe(true);
    expect(restored.find((run) => run.text.includes("sonu"))?.color).toBe("#cc0000");
    expect(restored.every((run) => run.size === 12)).toBe(true);
  });

  it("returns the runs untouched when there are no originals", () => {
    const edited = runs(["x", BOLD]);
    expect(restoreOriginalRunStyles(edited, [], PLAIN)).toBe(edited);
  });
});

describe("sameRuns and hasMixedStyles", () => {
  it("ignores property order and run splitting", () => {
    const left = runs(["ab", PLAIN], ["c", PLAIN]);
    const right: Run[] = [{ text: "abc", superscript: false, italic: false, bold: false, color: "#111111", size: 12, fontXref: 0, font: "helv" }];
    expect(sameRuns(left, right)).toBe(true);
    expect(sameRuns(left, runs(["abc", BOLD]))).toBe(false);
  });

  it("detects more than one visible style", () => {
    expect(hasMixedStyles(runs(["a ", PLAIN], ["b", BOLD]))).toBe(true);
    expect(hasMixedStyles(runs(["a", PLAIN], [" ", BOLD]))).toBe(false);
    expect(hasMixedStyles(runs(["a", PLAIN]))).toBe(false);
  });
});
