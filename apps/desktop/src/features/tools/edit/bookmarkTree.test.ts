import { describe, expect, it } from "vitest";
import type { BookmarkItem } from "@/types";
import { bookmarkIssue, hasChildren, moveBookmarkBranch, serializeBookmarks, setAllCollapsed, sortBookmarksByPage, withPage } from "./bookmarkTree";

const item = (level: number, title: string, page: number): BookmarkItem => ({ level, title, page });

describe("sortBookmarksByPage", () => {
  it("orders siblings by page and carries each branch along", () => {
    const sorted = sortBookmarksByPage([item(1, "B", 9), item(2, "B2", 12), item(2, "B1", 10), item(1, "A", 2), item(2, "A1", 3)]);
    expect(sorted.map((entry) => entry.title)).toEqual(["A", "A1", "B", "B1", "B2"]);
  });

  it("keeps bookmarks without a page after the ones that have one", () => {
    const sorted = sortBookmarksByPage([item(1, "none", 0), item(1, "late", 5), item(1, "early", 1)]);
    expect(sorted.map((entry) => entry.title)).toEqual(["early", "late", "none"]);
  });

  it("returns an empty outline unchanged", () => {
    expect(sortBookmarksByPage([])).toEqual([]);
  });
});

describe("setAllCollapsed", () => {
  it("closes only entries that have children", () => {
    const items = setAllCollapsed([item(1, "A", 1), item(2, "A1", 2), item(1, "B", 3)], true);
    expect(items.map((entry) => entry.collapsed)).toEqual([true, false, false]);
    expect(hasChildren(items, 0)).toBe(true);
    expect(hasChildren(items, 2)).toBe(false);
  });
});

describe("moveBookmarkBranch", () => {
  const outline = [item(1, "A", 1), item(2, "A1", 2), item(1, "B", 3), item(2, "B1", 4), item(1, "C", 5)];

  it("moves a bookmark down together with its children", () => {
    expect(moveBookmarkBranch(outline, 0, 1).map((entry) => entry.title)).toEqual(["B", "B1", "A", "A1", "C"]);
  });

  it("moves a bookmark up past the whole previous branch", () => {
    expect(moveBookmarkBranch(outline, 4, -1).map((entry) => entry.title)).toEqual(["A", "A1", "C", "B", "B1"]);
  });

  it("leaves the outline alone at either end", () => {
    expect(moveBookmarkBranch(outline, 0, -1)).toBe(outline);
    expect(moveBookmarkBranch(outline, 4, 1)).toBe(outline);
  });

  it("keeps a first or last child inside its parent", () => {
    expect(moveBookmarkBranch(outline, 1, -1)).toBe(outline);
    expect(moveBookmarkBranch(outline, 1, 1)).toBe(outline);
    expect(moveBookmarkBranch(outline, 3, -1)).toBe(outline);
  });

  it("swaps children of the same parent", () => {
    const family = [item(1, "P", 1), item(2, "a", 2), item(3, "a1", 2), item(2, "b", 3)];
    expect(moveBookmarkBranch(family, 3, -1).map((entry) => entry.title)).toEqual(["P", "b", "a", "a1"]);
  });
});

describe("serializeBookmarks", () => {
  it("writes the edited list in the bookmark file format", () => {
    const text = serializeBookmarks([
      { level: 1, title: "Giriş", page: 1, left: 72, top: 36, zoom: null, collapsed: true },
      { level: 2, title: "Alt", page: 3, left: null, top: null },
    ]);
    expect(JSON.parse(text)).toEqual({
      bookmarks: [
        { level: 1, title: "Giriş", page: 1, left: 72, top: 36, collapsed: true },
        { level: 2, title: "Alt", page: 3 },
      ],
    });
  });

  it("writes an empty list when nothing is left", () => {
    expect(JSON.parse(serializeBookmarks([]))).toEqual({ bookmarks: [] });
  });
});

describe("withPage", () => {
  it("drops the old position and a box that belonged to the old page", () => {
    const moved = withPage({ ...item(1, "A", 1), left: 10, top: 20, fit: "FitR", fitArgs: [1, 2, 3, 4], color: "#ff0000" }, 2);
    expect(moved).toMatchObject({ page: 2, left: null, top: null, fit: null, fitArgs: null, color: "#ff0000" });
  });

  it("keeps a whole-page fit and leaves an unchanged page alone", () => {
    const fitted = { ...item(1, "A", 1), fit: "Fit" as const, fitArgs: [] };
    expect(withPage(fitted, 3).fit).toBe("Fit");
    expect(withPage(fitted, 1)).toBe(fitted);
  });
});

describe("bookmarkIssue", () => {
  it("reports level jumps, empty titles and pages outside the document", () => {
    expect(bookmarkIssue([item(2, "A", 1)], 5)).toBe("levels");
    expect(bookmarkIssue([item(1, "  ", 1)], 5)).toBe("title");
    expect(bookmarkIssue([item(1, "A", 6)], 5)).toBe("page");
    expect(bookmarkIssue([item(1, "A", Number.NaN)], 5)).toBe("page");
  });

  it("accepts page 0 and links that open something else", () => {
    expect(bookmarkIssue([item(1, "A", 0), { ...item(1, "Web", 0), target: "web", uri: "https://a.b" }, { ...item(1, "Other", 9), target: "file", file: "b.pdf" }], 5)).toBeNull();
  });
});

describe("serializeBookmarks targets", () => {
  it("writes links, fit modes and styles but never the internal source number", () => {
    const text = serializeBookmarks([{ ...item(1, "Web", 0), target: "web", uri: "https://a.b", color: "#ff0000", bold: true, source: 12 }, { ...item(1, "Wide", 2), top: 40, fit: "FitH", fitArgs: [700] }]);
    expect(JSON.parse(text)).toEqual({
      bookmarks: [
        { level: 1, title: "Web", page: 0, target: "web", uri: "https://a.b", color: "#ff0000", bold: true },
        { level: 1, title: "Wide", page: 2, top: 40, fit: "FitH", fitArgs: [700] },
      ],
    });
  });
});
