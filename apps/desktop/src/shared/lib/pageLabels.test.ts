import { describe, expect, it } from "vitest";
import { pageFromInput, pageLabelOf } from "./pageLabels";

const labels = ["i", "ii", "1", "2", "3", "4", "A-1", "A-2"];

describe("page labels", () => {
  it("shows the printed label and falls back to the page number", () => {
    expect(pageLabelOf(labels, 2)).toBe("ii");
    expect(pageLabelOf(labels, 6)).toBe("4");
    expect(pageLabelOf(null, 6)).toBe("6");
    expect(pageLabelOf(["i", ""], 2)).toBe("2");
  });

  it("resolves a typed label before a physical page number", () => {
    expect(pageFromInput("ii", labels, 8)).toBe(2);
    expect(pageFromInput(" II ", labels, 8)).toBe(2);
    expect(pageFromInput("3", labels, 8)).toBe(5);
    expect(pageFromInput("a-2", labels, 8)).toBe(8);
    expect(pageFromInput("8", labels, 8)).toBe(8);
  });

  it("rejects unknown labels, empty input and pages out of range", () => {
    expect(pageFromInput("xiv", labels, 8)).toBeNull();
    expect(pageFromInput("", labels, 8)).toBeNull();
    expect(pageFromInput("9", null, 8)).toBeNull();
    expect(pageFromInput("0", null, 8)).toBeNull();
    expect(pageFromInput("2", null, 8)).toBe(2);
  });
});
