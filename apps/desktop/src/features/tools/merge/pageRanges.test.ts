import { describe, expect, it } from "vitest";
import { mergedPageTotal, moveToSlot, sortedByName, sortedByPageCount } from "./pageRanges";

describe("mergedPageTotal", () => {
  it("adds a blank after every odd document but the last when padding", () => {
    expect(mergedPageTotal([3, 2, 5], false, true)).toBe(11);
    expect(mergedPageTotal([3, 2, 5], false, false)).toBe(10);
  });

  it("never pads when interleaving", () => {
    expect(mergedPageTotal([3, 3], true, true)).toBe(6);
  });
});

describe("sortedByName", () => {
  it("orders numbers inside names naturally", () => {
    const items = [{ path: "C:/scan 10.pdf" }, { path: "C:/scan 2.pdf" }, { path: "C:/Scan 1.pdf" }];
    const names = sortedByName(items, "en", (path) => path.split("/").pop() ?? path).map((item) => item.path);
    expect(names).toEqual(["C:/Scan 1.pdf", "C:/scan 2.pdf", "C:/scan 10.pdf"]);
  });
});

describe("moveToSlot", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  const ids = (list: { id: string }[]) => list.map((item) => item.id).join("");

  it("moves an item down or up to the slot before the given row", () => {
    expect(ids(moveToSlot(items, "a", 3))).toBe("bcad");
    expect(ids(moveToSlot(items, "d", 0))).toBe("dabc");
    expect(ids(moveToSlot(items, "b", 4))).toBe("acdb");
  });

  it("returns the same list when the item lands where it was", () => {
    expect(moveToSlot(items, "b", 1)).toBe(items);
    expect(moveToSlot(items, "b", 2)).toBe(items);
  });

  it("ignores an unknown id and clamps the slot", () => {
    expect(moveToSlot(items, "z", 0)).toBe(items);
    expect(ids(moveToSlot(items, "a", 99))).toBe("bcda");
  });
});

describe("sortedByPageCount", () => {
  it("puts short documents first and unknown counts last", () => {
    const sorted = sortedByPageCount([{ pageCount: 9 }, {}, { pageCount: 2 }]);
    expect(sorted.map((item) => item.pageCount)).toEqual([2, 9, undefined]);
  });
});
