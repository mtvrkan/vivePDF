import { describe, expect, it } from "vitest";
import { createText } from "../model/design";
import { applyRunStyle, boldPatch, compactRuns, paragraphIndexes, replaceRange, restoreSelection, runsFromDom, selectionOffsets, shiftLevel, styleSummary, textFromDom, toggleList, updateParagraphs, weightPatch, withElementStyle } from "./richText";

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
  it("styles runs with their own font, size, weight and strike", () => {
    const element = base();

    const sized = { ...element, runs: applyRunStyle(element, 0, 5, { fontId: "system:georgia", scale: 1.5 }) };
    const runs = applyRunStyle(sized, 6, 11, { ...weightPatch(300), strike: true });

    expect(runs).toEqual([{ text: "Hello", fontId: "system:georgia", scale: 1.5 }, { text: " " }, { text: "brave", weight: 300, strike: true }, { text: " world" }]);
    expect(styleSummary({ ...element, runs }, 6, 11)).toMatchObject({ weight: 300, bold: false, strike: true, scale: 1 });
    expect(withElementStyle({ ...element, runs }, boldPatch(true)).runs).toEqual([{ text: "Hello", fontId: "system:georgia", scale: 1.5 }, { text: " " }, { text: "brave", strike: true }, { text: " world" }]);
  });

  it("replaces a range with text styled like the replaced part", () => {
    const element = { ...base(), runs: [{ text: "Hello " }, { text: "brave", italic: true }, { text: " world" }] };

    expect(replaceRange(element, 6, 11, "bold")).toEqual([{ text: "Hello " }, { text: "bold", italic: true }, { text: " world" }]);
    expect(replaceRange(element, 0, 6, "")).toEqual([{ text: "brave", italic: true }, { text: " world" }]);
    expect(replaceRange(element, 17, 17, "!")).toEqual([{ text: "Hello " }, { text: "brave", italic: true }, { text: " world!" }]);
  });

  it("finds the paragraphs a selection touches and changes their lists", () => {
    const element = createText(0, 0, 100, 40, "one\ntwo\nthree");

    expect(paragraphIndexes(element.runs, 0, 0)).toEqual([0]);
    expect(paragraphIndexes(element.runs, 2, 5)).toEqual([0, 1]);
    expect(paragraphIndexes(element.runs, 8, 8)).toEqual([2]);
    const listed = updateParagraphs(element, [0, 1], toggleList([], "bullet"));
    expect(listed).toEqual([{ list: "bullet", level: 0 }, { list: "bullet", level: 0 }, { list: "none", level: 0 }]);
    const deeper = updateParagraphs({ ...element, paragraphs: listed }, null, shiftLevel(1));
    expect(deeper).toEqual([{ list: "bullet", level: 1 }, { list: "bullet", level: 1 }, { list: "none", level: 0 }]);
    expect(updateParagraphs({ ...element, paragraphs: listed }, [0, 1], toggleList(listed.slice(0, 2), "bullet"))[0]).toEqual({ list: "none", level: 0 });
  });

  it("reads paragraph blocks with list markers and per-run styles back", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-para="" data-list="decimal" data-level="1"><span data-marker="">1.</span><span data-f="system:georgia" data-z="2" data-w="300">Big</span> one</div>' +
      '<div data-para="" data-list="decimal" data-level="1"><span data-marker="">2.</span><span data-s="1">two</span></div>' +
      '<div data-para="" data-list="none" data-level="0"><br></div>';

    const { runs, paragraphs } = textFromDom(root, base());

    expect(runs).toEqual([{ text: "Big", fontId: "system:georgia", scale: 2, weight: 300 }, { text: " one\n" }, { text: "two", strike: true }, { text: "\n" }]);
    expect(paragraphs).toEqual([{ list: "decimal", level: 1 }, { list: "decimal", level: 1 }, { list: "none", level: 0 }]);
  });

  it("ignores unknown list kinds and out-of-range sizes from pasted markup", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div data-list="star" data-level="99"><span data-z="9999">x</span></div>';

    const { runs, paragraphs } = textFromDom(root, base());

    expect(paragraphs).toEqual([{ list: "none", level: 8 }]);
    expect(runs).toEqual([{ text: "x", scale: 40 }]);
  });
});
