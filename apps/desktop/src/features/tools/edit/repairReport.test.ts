import { describe, expect, it } from "vitest";
import { canOpenIssuePage, groupIssues, repairOutcome } from "./repairReport";
import type { RepairResult } from "@/types";

const base: RepairResult = {
  output: "out.pdf",
  pageCount: 6,
  bytes: 1000,
  wasRepaired: false,
  xrefCount: 40,
  damagedPages: 0,
  emptyPages: 0,
  droppedPages: 0,
  rebuilt: false,
  signed: false,
  recoveredBy: "mupdf",
  issues: [],
  issuesTruncated: false,
};

describe("repairOutcome", () => {
  it("says the file was already sound when nothing was wrong", () => {
    expect(repairOutcome(base).key).toBe("tools.edit.repair.clean");
  });

  it("says the structure was mended when the reader had to rebuild it", () => {
    expect(repairOutcome({ ...base, wasRepaired: true }).key).toBe("tools.edit.repair.repaired");
  });

  it("counts the pages whose content could not be rewritten", () => {
    expect(repairOutcome({ ...base, damagedPages: 2 })).toEqual({
      key: "tools.edit.repair.damaged",
      count: 2,
    });
  });

  it("leads with the pages that were lost when the file had to be rebuilt", () => {
    expect(repairOutcome({ ...base, rebuilt: true, droppedPages: 1, damagedPages: 5 })).toEqual({
      key: "tools.edit.repair.rebuiltPartly",
      count: 1,
    });
  });

  it("says the rebuild kept everything when nothing was dropped", () => {
    expect(repairOutcome({ ...base, rebuilt: true }).key).toBe("tools.edit.repair.rebuilt");
  });

  it("warns when every page that came back is blank", () => {
    expect(repairOutcome({ ...base, emptyPages: 6, damagedPages: 6 }).key).toBe(
      "tools.edit.repair.allEmpty",
    );
  });
});

describe("repairOutcome blank pages", () => {
  it("adds the blank page count when only some pages are blank", () => {
    expect(repairOutcome({ ...base, emptyPages: 2 })).toEqual({ key: "tools.edit.repair.clean", blank: 2 });
  });

  it("leaves the blank count out when every page is blank", () => {
    expect(repairOutcome({ ...base, emptyPages: 6 }).blank).toBeUndefined();
  });

  it("keeps the blank count next to a rebuild", () => {
    expect(repairOutcome({ ...base, rebuilt: true, droppedPages: 1, emptyPages: 1 })).toEqual({ key: "tools.edit.repair.rebuiltPartly", count: 1, blank: 1 });
  });
});

describe("repair issues", () => {
  it("groups the pages by what went wrong, lost pages first", () => {
    const issues = [
      { page: 2, kind: "empty" as const },
      { page: 3, kind: "dropped" as const },
      { page: 5, kind: "empty" as const },
    ];
    expect(groupIssues(issues)).toEqual([
      { kind: "dropped", pages: [3] },
      { kind: "empty", pages: [2, 5] },
    ]);
  });

  it("returns no groups for a clean file", () => {
    expect(groupIssues([])).toEqual([]);
  });

  it("only opens pages whose numbers still match the repaired copy", () => {
    expect(canOpenIssuePage(base, "empty")).toBe(true);
    expect(canOpenIssuePage(base, "dropped")).toBe(false);
    expect(canOpenIssuePage({ ...base, droppedPages: 1 }, "empty")).toBe(false);
  });
});
