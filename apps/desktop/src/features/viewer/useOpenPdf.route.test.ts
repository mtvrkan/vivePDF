import { describe, expect, it } from "vitest";
import { leavesForDocument } from "./launchPanel";

describe("leavesForDocument", () => {
  it("moves to the viewer from another page", () => {
    const leaves = leavesForDocument("/tools/convert", "/viewer");

    expect(leaves).toBe(true);
  });

  it("stays on the viewer so a panel asked for in its address still opens", () => {
    const leaves = leavesForDocument("/viewer", "/viewer");

    expect(leaves).toBe(false);
  });

  it("stays on the page organizer", () => {
    const leaves = leavesForDocument("/pages", "/viewer");

    expect(leaves).toBe(false);
  });
});
