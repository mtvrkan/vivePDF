import { describe, expect, it } from "vitest";
import { findingsByPage } from "./findingsByPage";

describe("findingsByPage", () => {
  it("groups the failing and warning checks under each page in page order", () => {
    const rows = findingsByPage([
      { id: "fonts", status: "fail", pages: [3, 1] },
      { id: "safeZone", status: "warn", pages: [1, 2] },
    ]);
    expect(rows).toEqual([
      { page: 1, status: "fail", checks: ["fonts", "safeZone"] },
      { page: 2, status: "warn", checks: ["safeZone"] },
      { page: 3, status: "fail", checks: ["fonts"] },
    ]);
  });

  it("raises a page to fail when a later check fails there", () => {
    const rows = findingsByPage([
      { id: "smallText", status: "warn", pages: [4] },
      { id: "inkCoverage", status: "fail", pages: [4] },
    ]);
    expect(rows[0]).toEqual({ page: 4, status: "fail", checks: ["smallText", "inkCoverage"] });
  });

  it("ignores passing checks and checks without pages", () => {
    expect(findingsByPage([{ id: "transparency", status: "pass", pages: [1], variant: "allowed" }, { id: "encryption", status: "warn" }])).toEqual([]);
  });
});
