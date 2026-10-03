import { describe, expect, it } from "vitest";
import { MAX_BOOK_CHAPTERS, chaptersByName, movedChapter, suggestedBookTitle, withChapters } from "./bookDocument";

describe("withChapters", () => {
  it("adds new text and Markdown files once, in the order they were picked", () => {
    const current = ["C:\\book\\01.md"];

    const next = withChapters(current, ["C:\\Book\\01.MD", "C:\\book\\02.txt", "C:\\book\\cover.png", "C:\\book\\03.markdown"]);

    expect(next).toEqual(["C:\\book\\01.md", "C:\\book\\02.txt", "C:\\book\\03.markdown"]);
  });

  it("stops at the chapter limit", () => {
    const many = Array.from({ length: MAX_BOOK_CHAPTERS + 5 }, (_, index) => `/book/${index}.md`);

    expect(withChapters([], many)).toHaveLength(MAX_BOOK_CHAPTERS);
  });
});

describe("movedChapter", () => {
  it("swaps a chapter with its neighbour and ignores moves past either end", () => {
    const chapters = ["a.md", "b.md", "c.md"];

    expect(movedChapter(chapters, 1, -1)).toEqual(["b.md", "a.md", "c.md"]);
    expect(movedChapter(chapters, 2, 1)).toBe(chapters);
    expect(movedChapter(chapters, 0, -1)).toBe(chapters);
  });
});

describe("chaptersByName", () => {
  it("sorts by file name with numbers in natural order", () => {
    expect(chaptersByName(["/b/10-end.md", "/a/2-middle.md", "/c/1-start.md"], "en")).toEqual(["/c/1-start.md", "/a/2-middle.md", "/b/10-end.md"]);
  });
});

describe("suggestedBookTitle", () => {
  it("names the book after the folder of its first chapter", () => {
    expect(suggestedBookTitle(["C:\\Writing\\field_guide\\01.md"])).toBe("field guide");
    expect(suggestedBookTitle([])).toBe("");
  });
});
