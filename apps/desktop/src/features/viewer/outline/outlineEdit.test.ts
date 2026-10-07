import { describe, expect, it } from "vitest";
import type { BookmarkItem } from "@/types";
import { deleteBookmarkBranch, indentBookmark, insertSibling, linkBookmarkToPage, mergeAddedBookmarks, outdentBookmark, rowsFromItems } from "./outlineEdit";

const item = (level: number, title: string, page: number, extra: Partial<BookmarkItem> = {}): BookmarkItem => ({ level, title, page, ...extra });

describe("outlineEdit", () => {
  it("merges an added bookmark before the first top-level item on a later page", () => {
    const items = [item(1, "A", 1), item(2, "A1", 4), item(1, "B", 5)];

    const merged = mergeAddedBookmarks(items, [{ title: "New", page: 3, y: 120 }]);

    expect(merged.map((entry) => entry.title)).toEqual(["A", "A1", "New", "B"]);
    expect(merged[2]).toEqual({ level: 1, title: "New", page: 3, top: 120 });
  });

  it("indents a branch only under an item at its level or deeper", () => {
    const items = [item(1, "A", 1), item(1, "B", 2), item(2, "B1", 3)];

    const indented = indentBookmark(items, 1);

    expect(indented.map((entry) => entry.level)).toEqual([1, 2, 3]);
    expect(indentBookmark(items, 0)).toBe(items);
    expect(outdentBookmark(items, 0)).toBe(items);
  });

  it("deletes a parent together with its branch", () => {
    const items = [item(1, "A", 1), item(2, "A1", 2), item(3, "A1a", 2), item(1, "B", 3)];

    expect(deleteBookmarkBranch(items, 0).map((entry) => entry.title)).toEqual(["B"]);
  });

  it("turns a kept web link into a page link", () => {
    const items = [item(1, "Web", 0, { target: "web", uri: "https://a.b", source: 7 })];

    const linked = linkBookmarkToPage(items, 0, 4);

    expect(linked[0]).toMatchObject({ target: "page", page: 4, uri: null });
  });

  it("adds a sibling after the selected branch, or by page when nothing is selected", () => {
    const items = [item(1, "A", 1), item(2, "A1", 2), item(1, "B", 5)];

    expect(insertSibling(items, 0, { title: "S", page: 3 }).index).toBe(2);
    expect(insertSibling(items, null, { title: "S", page: 3 }).items[2]).toMatchObject({ title: "S", level: 1 });
  });

  it("builds hierarchical row ids that match the engine outline", () => {
    const rows = rowsFromItems([item(1, "A", 1), item(2, "A1", 2), item(1, "B", 0, { target: "web", uri: "https://x.y" })]);

    expect(rows.map((row) => [row.id, row.parentId, row.pageIndex, row.uri])).toEqual([
      ["0", null, 0, null],
      ["0.0", "0", 1, null],
      ["1", null, null, "https://x.y"],
    ]);
  });
});
