import { describe, expect, it } from "vitest";
import { matchingPaths, sortedPaths } from "./collectionFiles";

const paths = ["C:/Work/b/report 10.pdf", "C:/Work/a/Report 2.docx", "C:/Home/notes.pdf"];

describe("sortedPaths", () => {
  it("keeps the collection order and sorts names naturally in both directions", () => {
    expect(sortedPaths(paths, "collection", "en")).toBe(paths);
    expect(sortedPaths(paths, "nameAsc", "en")).toEqual(["C:/Home/notes.pdf", "C:/Work/a/Report 2.docx", "C:/Work/b/report 10.pdf"]);
    expect(sortedPaths(paths, "nameDesc", "en")).toEqual(["C:/Work/b/report 10.pdf", "C:/Work/a/Report 2.docx", "C:/Home/notes.pdf"]);
  });

  it("groups by folder or file type and falls back to the name inside a group", () => {
    expect(sortedPaths(paths, "folder", "en")).toEqual(["C:/Home/notes.pdf", "C:/Work/a/Report 2.docx", "C:/Work/b/report 10.pdf"]);
    expect(sortedPaths(paths, "type", "en")).toEqual(["C:/Work/a/Report 2.docx", "C:/Home/notes.pdf", "C:/Work/b/report 10.pdf"]);
  });
});

describe("matchingPaths", () => {
  it("matches the name or the folder without caring about case", () => {
    expect(matchingPaths(paths, "REPORT", "en")).toEqual(["C:/Work/b/report 10.pdf", "C:/Work/a/Report 2.docx"]);
    expect(matchingPaths(paths, "home", "en")).toEqual(["C:/Home/notes.pdf"]);
  });

  it("returns every path for an empty query and none for a miss", () => {
    expect(matchingPaths(paths, "  ", "en")).toBe(paths);
    expect(matchingPaths(paths, "invoice", "en")).toEqual([]);
  });
});
