import { describe, expect, it } from "vitest";
import type { RecentFile } from "@/types";
import { matchingRecent, pinnedFirst, sortedRecent } from "./recentList";

const items: RecentFile[] = [
  { path: "C:/Work/b/report 10.pdf", fileName: "report 10.pdf", openedAt: 3 },
  { path: "C:/Müşteri/a/Özet.pdf", fileName: "Özet.pdf", openedAt: 2, pinned: true },
  { path: "C:/Home/notes 2.pdf", fileName: "notes 2.pdf", openedAt: 1 },
];

describe("matchingRecent", () => {
  it("matches the file name and the folder without case or diacritics", () => {
    const byName = matchingRecent(items, "OZET", "en");
    const byFolder = matchingRecent(items, "musteri", "en");

    expect(byName.map((item) => item.fileName)).toEqual(["Özet.pdf"]);
    expect(byFolder.map((item) => item.fileName)).toEqual(["Özet.pdf"]);
  });

  it("returns every entry for a blank query", () => {
    const result = matchingRecent(items, "   ", "en");

    expect(result).toBe(items);
  });

  it("returns nothing when no name or folder matches", () => {
    const result = matchingRecent(items, "invoice", "en");

    expect(result).toEqual([]);
  });
});

describe("sortedRecent", () => {
  it("keeps the opening order for the recent sort", () => {
    const result = sortedRecent(items, "recent", "en");

    expect(result).toBe(items);
  });

  it("sorts names naturally from A to Z", () => {
    const result = sortedRecent(items, "name", "en");

    expect(result.map((item) => item.fileName)).toEqual(["notes 2.pdf", "Özet.pdf", "report 10.pdf"]);
  });

  it("sorts by folder, then by name", () => {
    const result = sortedRecent(items, "folder", "en");

    expect(result.map((item) => item.fileName)).toEqual(["notes 2.pdf", "Özet.pdf", "report 10.pdf"]);
  });
});

describe("pinnedFirst", () => {
  it("moves pinned entries ahead and keeps the order inside each group", () => {
    const result = pinnedFirst(items);

    expect(result.map((item) => item.fileName)).toEqual(["Özet.pdf", "report 10.pdf", "notes 2.pdf"]);
  });
});
