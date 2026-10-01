import { describe, expect, it } from "vitest";
import { cutsToRanges, rangesToCuts, splitParts, textSplitPattern } from "./splitParts";

describe("splitParts", () => {
  it("makes one part per semicolon", () => {
    expect(splitParts("1-3; 4-6", 6)?.map((part) => part.label)).toEqual(["1-3", "4-6"]);
  });

  it("reads an open end as the rest of the document", () => {
    expect(splitParts("7-", 12)).toEqual([{ label: "7-12", pages: 6 }]);
  });

  it("leaves an open end open while the document is unknown", () => {
    expect(splitParts("4-", null)).toEqual([{ label: "4-", pages: null }]);
  });

  it("gathers the pages a comma joins into one part", () => {
    const parts = splitParts("1,3,5; 2", 6);
    expect(parts?.length).toBe(2);
    expect(parts?.[0]).toEqual({ label: "1-5", pages: 3 });
  });

  it("takes a lone page as its own part", () => {
    expect(splitParts("2; 4", 6)?.map((part) => part.label)).toEqual(["2", "4"]);
  });

  it("refuses a page past the end", () => {
    expect(splitParts("1-9", 6)).toBeNull();
    expect(splitParts("9", 6)).toBeNull();
  });

  it("accepts a backwards range as the engine does, naming the part in page order", () => {
    expect(splitParts("5-2", 6)).toEqual([{ label: "5-2", pages: 4 }]);
    expect(splitParts("3,1", 6)).toEqual([{ label: "3-1", pages: 2 }]);
  });

  it("names a part by its first and last page as the engine names the file", () => {
    expect(splitParts("2,2", 6)).toEqual([{ label: "2-2", pages: 2 }]);
    expect(splitParts("4-6,1", 6)?.[0].label).toBe("4-1");
  });

  it("refuses a range that ends before the first page", () => {
    expect(splitParts("3-0", 6)).toBeNull();
  });

  it("refuses nonsense", () => {
    expect(splitParts("abc", 6)).toBeNull();
    expect(splitParts("", 6)).toBeNull();
    expect(splitParts(";;", 6)).toBeNull();
    expect(splitParts("1-3;", 6)?.length).toBe(1);
  });

  it("counts a page named twice in the same part twice, as the engine copies it twice", () => {
    expect(splitParts("1-3,2", 6)?.[0].pages).toBe(4);
  });
});

describe("cutsToRanges", () => {
  it("turns part starts into consecutive ranges up to the last page", () => {
    expect(cutsToRanges([4, 7], 9)).toBe("1-3; 4-6; 7-9");
    expect(cutsToRanges([9, 2], 9)).toBe("1; 2-8; 9");
  });

  it("keeps the whole document as one part without cuts and ignores pages out of range", () => {
    expect(cutsToRanges([], 5)).toBe("1-5");
    expect(cutsToRanges([1, 12], 5)).toBe("1-5");
  });
});

describe("rangesToCuts", () => {
  it("reads back cuts from consecutive ranges", () => {
    expect(rangesToCuts("1-3; 4-6; 7-", 9)).toEqual([4, 7]);
    expect(rangesToCuts(cutsToRanges([2, 5], 8), 8)).toEqual([2, 5]);
  });

  it("gives no cuts for ranges that skip, overlap or list pages", () => {
    expect(rangesToCuts("1-3; 5-9", 9)).toEqual([]);
    expect(rangesToCuts("1-3; 2-9", 9)).toEqual([]);
    expect(rangesToCuts("1,3; 4-9", 9)).toEqual([]);
    expect(rangesToCuts("1-3", 9)).toEqual([]);
  });
});

describe("textSplitPattern", () => {
  it("turns plain text into a pattern that keeps the rest of the line as the label", () => {
    const pattern = textSplitPattern("  Invoice No. ", false);
    expect(pattern).toBe("(Invoice No\\.[^\\n]*)");
    expect(new RegExp(pattern, "i").exec("x invoice no. 42 ok\nnext")?.[1]).toBe("invoice no. 42 ok");
  });

  it("passes a regular expression through", () => {
    expect(textSplitPattern("No: (\\d+)", true)).toBe("No: (\\d+)");
  });

  it("gives nothing for empty text", () => {
    expect(textSplitPattern("   ", false)).toBe("");
  });
});
