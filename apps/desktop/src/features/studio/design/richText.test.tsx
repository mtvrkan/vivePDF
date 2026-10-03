import { describe, expect, it } from "vitest";
import { createText } from "../model/design";
import { applyRunStyle, compactRuns, restoreSelection, runsFromDom, selectionOffsets, styleSummary, withElementStyle } from "./richText";

const base = () => createText(0, 0, 100, 40, "Hello brave world", { color: "#111111" });

describe("studio rich text", () => {
  it("styles a part of the text and merges equal neighbours", () => {
    const element = base();

    const runs = applyRunStyle(element, 6, 11, { bold: true });

    expect(runs).toEqual([{ text: "Hello " }, { text: "brave", bold: true }, { text: " world" }]);
    expect(applyRunStyle({ ...element, runs }, 6, 11, { bold: false })).toEqual([{ text: "Hello brave world" }]);
    expect(applyRunStyle(element, 3, 3, { bold: true })).toBe(element.runs);
  });

  it("summarises what the whole selection shares", () => {
    const element = { ...base(), runs: [{ text: "Hello " }, { text: "brave", bold: true, color: "#ff0000" }, { text: " world" }] };

    expect(styleSummary(element, 6, 11)).toMatchObject({ bold: true, color: "#ff0000" });
    expect(styleSummary(element, 0, 11).bold).toBe(false);
  });

  it("drops run overrides when the whole element changes", () => {
    const element = { ...base(), runs: [{ text: "Hi ", italic: true, bold: true }, { text: "there" }] };

    const next = withElementStyle(element, { bold: true });

    expect(next.bold).toBe(true);
    expect(next.runs).toEqual([{ text: "Hi ", italic: true }, { text: "there" }]);
  });

  it("removes overrides equal to the element and empty runs", () => {
    expect(compactRuns(base(), [{ text: "" }, { text: "a", color: "#111111" }, { text: "b" }])).toEqual([{ text: "ab" }]);
  });

  it("reads edited markup back into runs", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span data-b="1">Bold</span> plain<br><span data-c="#FF0000" data-i="1">red</span><div>next</div><br>';

    expect(runsFromDom(root, base())).toEqual([
      { text: "Bold", bold: true },
      { text: " plain\n" },
      { text: "red", italic: true, color: "#ff0000" },
      { text: "\nnext" },
    ]);
  });

  it("maps the caret to text offsets and back across line breaks", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span data-b="1">ab</span><br><span>cd</span>';
    document.body.append(root);

    restoreSelection(root, 1, 4);

    expect(selectionOffsets(root)).toEqual({ start: 1, end: 4 });
    root.remove();
  });
});
