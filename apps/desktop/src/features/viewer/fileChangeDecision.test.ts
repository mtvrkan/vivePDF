import { describe, expect, it } from "vitest";
import { fileChangeAction, watchablePaths } from "./fileChangeDecision";

const clean = { exists: true, unsaved: false, reloadOnChange: true, active: true };

describe("fileChangeAction", () => {
  it("reloads the active document with no unsaved work", () => {
    expect(fileChangeAction(clean)).toBe("reload");
  });

  it("marks an inactive document stale", () => {
    expect(fileChangeAction({ ...clean, active: false })).toBe("stale");
  });

  it("reports a conflict when there is unsaved work", () => {
    expect(fileChangeAction({ ...clean, unsaved: true })).toBe("conflict");
  });

  it("reports a missing file before anything else", () => {
    expect(fileChangeAction({ ...clean, exists: false, unsaved: true })).toBe("missing");
  });

  it("only shows a banner when the preference is off", () => {
    expect(fileChangeAction({ ...clean, reloadOnChange: false })).toBe("changed");
  });
});

describe("watchablePaths", () => {
  it("keeps one entry per PDF and skips converted copies and other files", () => {
    const original = String.raw`C:\Docs\A.pdf`;

    const watched = watchablePaths([original, "c:/docs/a.pdf", "C:/tmp/copy.pdf", "C:/docs/notes.docx"], (path) => path === "C:/tmp/copy.pdf");

    expect([...watched.values()]).toEqual([original]);
  });

  it("returns nothing for no documents", () => {
    expect(watchablePaths([], () => false).size).toBe(0);
  });
});
