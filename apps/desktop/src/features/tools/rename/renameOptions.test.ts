import { describe, expect, it } from "vitest";
import type { RenameItem } from "@/types";
import { extensionOf, failureKey, policyParams, sortPaths, undoPlan, withoutKey } from "./renameOptions";

function item(path: string, overrides: Partial<RenameItem> = {}): RenameItem {
  return { path, newName: "x", fields: { pages: "1" }, conflict: false, error: null, bytes: 0, modified: 0, recognised: false, ...overrides };
}

describe("sortPaths", () => {
  const paths = ["C:/a/file10.pdf", "C:/a/file2.pdf", "C:/a/File1.pdf"];
  const byPath = new Map([
    [paths[0], item(paths[0], { bytes: 30, modified: 1, fields: { pages: "4" } })],
    [paths[1], item(paths[1], { bytes: 10, modified: 3, fields: { pages: "9" } })],
    [paths[2], item(paths[2], { error: "NEEDS_PASSWORD" })],
  ]);

  it("keeps the added order or reverses it", () => {
    expect(sortPaths(paths, byPath, "added", false)).toBe(paths);
    expect(sortPaths(paths, byPath, "added", true)).toEqual([...paths].reverse());
  });

  it("sorts names naturally without caring about case", () => {
    expect(sortPaths(paths, byPath, "name", false)).toEqual(["C:/a/File1.pdf", "C:/a/file2.pdf", "C:/a/file10.pdf"]);
  });

  it("sorts by size, date and pages and leaves unreadable files last", () => {
    expect(sortPaths(paths, byPath, "size", false)).toEqual([paths[1], paths[0], paths[2]]);
    expect(sortPaths(paths, byPath, "modified", true)).toEqual([paths[1], paths[0], paths[2]]);
    expect(sortPaths(paths, byPath, "pages", true)).toEqual([paths[1], paths[0], paths[2]]);
  });

  it("keeps the order while nothing is known yet", () => {
    expect(sortPaths(paths, new Map(), "size", false)).toEqual(paths);
  });
});

describe("rename helpers", () => {
  it("maps each conflict choice to the apply flags", () => {
    expect(policyParams("number")).toEqual({ autoUnique: true, overwrite: false });
    expect(policyParams("skip")).toEqual({ autoUnique: false, overwrite: false });
    expect(policyParams("overwrite")).toEqual({ autoUnique: false, overwrite: true });
  });

  it("plans an undo only for files that really moved", () => {
    expect(
      undoPlan({
        renamed: 1,
        createdDirs: ["C:/a/2026"],
        results: [
          { path: "C:/a/one.pdf", output: "C:/a/2026/x.pdf", ok: true, error: null, replaced: false },
          { path: "C:/a/two.pdf", output: "C:/a/two.pdf", ok: true, error: null, replaced: false },
          { path: "C:/a/three.pdf", output: null, ok: false, error: "EXISTS", replaced: false },
        ],
      }),
    ).toEqual({ items: [{ path: "C:/a/2026/x.pdf", original: "C:/a/one.pdf" }], removeDirs: ["C:/a/2026"] });
    expect(undoPlan({ renamed: 0, createdDirs: [], results: [] })).toBeNull();
  });

  it("reads extensions, failure keys and drops overrides", () => {
    expect(extensionOf("C:/a/b.c/Report.PDF")).toBe(".PDF");
    expect(extensionOf("C:/a/.hidden")).toBe("");
    expect(failureKey("EXISTS")).toBe("tools.rename.failure.exists");
    expect(failureKey("[WinError 5] Access is denied")).toBe("tools.rename.failure.other");
    const record = { a: "1" };
    expect(withoutKey(record, "b")).toBe(record);
    expect(withoutKey(record, "a")).toEqual({});
  });
});
