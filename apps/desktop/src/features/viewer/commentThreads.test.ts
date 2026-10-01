import { describe, expect, it } from "vitest";
import type { CommentItem } from "@/types";
import { commentThreads } from "./commentThreads";

function comment(xref: number, parent: number | null = null, author = "Ayşe"): CommentItem {
  return { xref, page: 1, type: "Text", author, subject: "", content: `c${xref}`, created: "", modified: "", color: null, rect: [0, 0, 1, 1], resolved: false, quote: "", parent, state: null };
}

const layout = (entries: ReturnType<typeof commentThreads>) => entries.map((entry) => [entry.item.xref, entry.depth]);

describe("commentThreads", () => {
  it("puts replies under their comment, deeper for replies to replies", () => {
    const items = [comment(1), comment(2), comment(3, 1), comment(4, 3), comment(5, 1)];
    expect(layout(commentThreads(items, () => true))).toEqual([
      [1, 0],
      [3, 1],
      [4, 2],
      [5, 1],
      [2, 0],
    ]);
  });

  it("filters whole threads by their first comment", () => {
    const items = [comment(1, null, "Ayşe"), comment(2, 1, "Can"), comment(3, null, "Can")];
    expect(layout(commentThreads(items, (item) => item.author === "Ayşe"))).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it("shows a reply whose comment is gone as its own thread and survives loops", () => {
    expect(layout(commentThreads([comment(7, 99)], () => true))).toEqual([[7, 0]]);
    expect(layout(commentThreads([comment(8, 8)], () => true))).toEqual([[8, 0]]);
    expect(layout(commentThreads([comment(1, 2), comment(2, 1)], () => true))).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });
});
