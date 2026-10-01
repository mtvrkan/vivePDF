import { describe, expect, it } from "vitest";
import { appendScan, autoScanName, movePage, orphanedParts, removePage, rotatePage, sessionParts, type SessionPage } from "./scanSession";

function counter() {
  let next = 0;
  return () => `p${next++}`;
}

describe("scan session", () => {
  it("adds every page of a new scan after the ones already there", () => {
    const makeId = counter();
    const pages = appendScan(appendScan([], "a.pdf", 2, makeId), "b.pdf", 1, makeId);
    expect(pages.map((item) => [item.path, item.page])).toEqual([
      ["a.pdf", 0],
      ["a.pdf", 1],
      ["b.pdf", 0],
    ]);
  });

  it("moves, rotates and removes a page without touching the others", () => {
    const pages = appendScan([], "a.pdf", 3, counter());
    expect(movePage(pages, "p2", -2).map((item) => item.id)).toEqual(["p2", "p0", "p1"]);
    expect(movePage(pages, "p0", -1)).toBe(pages);
    expect(movePage(pages, "p2", 1)).toBe(pages);
    const turned = rotatePage(rotatePage(rotatePage(rotatePage(pages, "p1"), "p1"), "p1"), "p1");
    expect(turned[1].rotation).toBe(0);
    expect(rotatePage(pages, "p1")[1].rotation).toBe(90);
    expect(removePage(pages, "p1").map((item) => item.id)).toEqual(["p0", "p2"]);
  });

  it("finds scans that no page uses any more", () => {
    const makeId = counter();
    const pages: SessionPage[] = appendScan(appendScan([], "a.pdf", 1, makeId), "b.pdf", 2, makeId);
    expect(sessionParts(pages)).toEqual(["a.pdf", "b.pdf"]);
    expect(orphanedParts(pages, removePage(pages, "p0"))).toEqual(["a.pdf"]);
    expect(orphanedParts(pages, removePage(pages, "p1"))).toEqual([]);
  });

  it("names a scan after the moment it is saved", () => {
    expect(autoScanName("scan", new Date(2026, 8, 2, 7, 5, 9))).toBe("scan 2026-09-02 07-05-09.pdf");
  });
});
