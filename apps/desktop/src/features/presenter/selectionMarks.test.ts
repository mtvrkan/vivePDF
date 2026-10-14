import { describe, expect, it } from "vitest";
import { MAX_SELECTION_RECTS, toSelectionMarks } from "./selectionMarks";

const LETTER = { width: 600, height: 800 };

describe("toSelectionMarks", () => {
  it("turns selected text boxes into fractions of their page", () => {
    const marks = toSelectionMarks({ 2: [{ origin: { x: 60, y: 200 }, size: { width: 300, height: 40 } }] }, () => LETTER, "#FFD400");

    expect(marks).toEqual({ color: "#FFD400", pages: { 2: [{ x: 0.1, y: 0.25, width: expect.closeTo(0.5), height: expect.closeTo(0.05) }] } });
  });

  it("clips boxes to the page and returns nothing for an empty selection or an unknown page", () => {
    const clipped = toSelectionMarks({ 0: [{ origin: { x: 540, y: -10 }, size: { width: 120, height: 50 } }] }, () => LETTER, "#FFD400");
    expect(clipped?.pages[0]).toEqual([{ x: 0.9, y: 0, width: expect.closeTo(0.1), height: expect.closeTo(0.05) }]);

    expect(toSelectionMarks({}, () => LETTER, "#FFD400")).toBeNull();
    expect(toSelectionMarks({ 4: [{ origin: { x: 0, y: 0 }, size: { width: 10, height: 10 } }] }, () => null, "#FFD400")).toBeNull();
  });

  it("stops at the size limit for a select-all on a long document", () => {
    const many = Array.from({ length: MAX_SELECTION_RECTS + 50 }, (_, index) => ({ origin: { x: 10, y: index % 700 }, size: { width: 20, height: 5 } }));

    const marks = toSelectionMarks({ 0: many }, () => LETTER, "#FFD400");

    expect(marks?.pages[0]).toHaveLength(MAX_SELECTION_RECTS);
  });
});
