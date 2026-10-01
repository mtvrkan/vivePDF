import { describe, expect, it } from "vitest";
import { BOOKMARK_TITLE_LIMIT, bookmarkTitleFrom } from "./bookmarkTitle";

describe("bookmarkTitleFrom", () => {
  it("uses the first non-empty line of the selection with collapsed spaces", () => {
    expect(bookmarkTitleFrom("\n  \r\n  Giriş   ve  amaç \nsecond line")).toBe("Giriş ve amaç");
  });

  it("gives nothing back for an empty selection so the caller can use the page name", () => {
    expect(bookmarkTitleFrom("")).toBe("");
    expect(bookmarkTitleFrom(" \n\t ")).toBe("");
  });

  it("shortens long selections with an ellipsis", () => {
    const title = bookmarkTitleFrom("a".repeat(400));
    expect(title).toHaveLength(BOOKMARK_TITLE_LIMIT);
    expect(title.endsWith("…")).toBe(true);
  });
});
