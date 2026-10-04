import { describe, expect, it } from "vitest";
import { createDesign, createText } from "../model/design";
import { findInText, findMatches, replaceMatches } from "./findReplace";

const loose = { matchCase: false, wholeWord: false, language: "en" };

function twoPages() {
  const design = createDesign("Deck", 200, 100);
  const second = { ...design.pages[0], id: "page-2", elements: [createText(0, 0, 100, 20, "cat and Cat", { id: "t2" })] };
  const first = {
    ...design.pages[0],
    elements: [createText(0, 0, 100, 20, "The cat sat", { id: "t1" }), createText(0, 30, 100, 20, "cat hidden", { id: "t3", hidden: true }), createText(0, 60, 100, 20, "cat locked", { id: "t4", locked: true })],
  };
  return { ...design, pages: [first, second] };
}

describe("studio find and replace", () => {
  it("finds every match across pages, skipping hidden and locked texts", () => {
    const matches = findMatches(twoPages(), "cat", loose);

    expect(matches.map((match) => [match.elementId, match.start])).toEqual([
      ["t1", 4],
      ["t2", 0],
      ["t2", 8],
    ]);
  });

  it("honours match case, whole words and Turkish case folding", () => {
    expect(findInText("Cat cat", "cat", { ...loose, matchCase: true })).toEqual([{ start: 4, end: 7 }]);
    expect(findInText("concat cat cats", "cat", { ...loose, wholeWord: true })).toEqual([{ start: 7, end: 10 }]);
    expect(findInText("IŞIK ışık", "ışık", { ...loose, language: "tr" })).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ]);
    expect(findInText("aaaa", "aa", loose)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("finds nothing for an empty query or a missing word", () => {
    expect(findInText("text", "", loose)).toEqual([]);
    expect(findMatches(twoPages(), "dog", loose)).toEqual([]);
  });

  it("replaces all matches keeping the run style and flattening new lines", () => {
    const design = twoPages();
    design.pages[1].elements[0] = createText(0, 0, 100, 20, "", { id: "t2", runs: [{ text: "cat and " }, { text: "Cat", bold: true }] });
    const matches = findMatches(design, "cat", loose);

    const next = replaceMatches(design, matches, "big\ndog");

    const second = next.pages[1].elements[0];
    expect(second.kind === "text" && second.runs).toEqual([{ text: "big dog and " }, { text: "big dog", bold: true }]);
    const first = next.pages[0].elements[0];
    expect(first.kind === "text" && first.runs).toEqual([{ text: "The big dog sat" }]);
    expect(replaceMatches(design, [], "x")).toBe(design);
  });
});
