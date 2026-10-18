import { describe, expect, it } from "vitest";
import { splitKeys } from "./shortcutGroups";

describe("splitKeys", () => {
  it("splits alternatives on spaced slashes and dots", () => {
    expect(splitKeys("PgUp / PgDn  ·  ← →")).toEqual(["PgUp", "PgDn", "← →"]);
  });

  it("keeps a slash that is itself the key", () => {
    expect(splitKeys("F1  /  Ctrl /")).toEqual(["F1", "Ctrl /"]);
    expect(splitKeys("F1  /  ⌘/")).toEqual(["F1", "⌘/"]);
  });

  it("returns nothing for an empty string", () => {
    expect(splitKeys("")).toEqual([]);
  });
});
