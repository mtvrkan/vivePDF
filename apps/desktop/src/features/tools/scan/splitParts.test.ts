import { describe, expect, it } from "vitest";
import { mergeWithPrevious, partPages, relabelPart, removePart, sameParts, splitPartAt } from "./splitParts";

const parts = [
  { firstPage: 1, lastPage: 3, label: null },
  { firstPage: 5, lastPage: 8, label: "Fatura" },
];

describe("split parts", () => {
  it("merges a part into the one before it and keeps the first label found", () => {
    expect(mergeWithPrevious(parts, 1)).toEqual([{ firstPage: 1, lastPage: 8, label: "Fatura" }]);
    expect(mergeWithPrevious(parts, 0)).toBe(parts);
  });

  it("splits a part at a page inside it and ignores pages outside", () => {
    expect(splitPartAt(parts, 1, 7)).toEqual([parts[0], { firstPage: 5, lastPage: 6, label: "Fatura" }, { firstPage: 7, lastPage: 8, label: null }]);
    expect(splitPartAt(parts, 1, 5)).toBe(parts);
    expect(splitPartAt(parts, 1, 9)).toBe(parts);
  });

  it("relabels, removes and compares parts", () => {
    expect(relabelPart(parts, 0, "  ")[0].label).toBeNull();
    expect(relabelPart(parts, 0, "Sözleşme")[0].label).toBe("Sözleşme");
    expect(removePart(parts, 0)).toEqual([parts[1]]);
    expect(partPages(parts[1])).toBe(4);
    expect(sameParts(parts, [...parts])).toBe(true);
    expect(sameParts(parts, relabelPart(parts, 1, "Other"))).toBe(false);
  });
});
