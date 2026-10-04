import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RECENT_COLORS, readRecentColors, RECENT_COLORS_KEY, useRecentColors, withRecentColor } from "./recentColors";

describe("recent colours", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useRecentColors.setState({ colors: [] });
  });

  it("puts the newest colour first, once, in lower case and keeps only the last few", () => {
    const many = Array.from({ length: MAX_RECENT_COLORS }, (_, index) => `#00000${index}`);

    expect(withRecentColor(["#111111", "#222222"], "#222222")).toEqual(["#222222", "#111111"]);
    expect(withRecentColor([], "#ABCDEF")).toEqual(["#abcdef"]);
    expect(withRecentColor(many, "#ffffff")).toHaveLength(MAX_RECENT_COLORS);
    expect(withRecentColor(["#111111"], "red")).toEqual(["#111111"]);
  });

  it("remembers picked colours for the next session", () => {
    useRecentColors.getState().push("#FF0000");
    useRecentColors.getState().push("#00ff00");

    expect(useRecentColors.getState().colors).toEqual(["#00ff00", "#ff0000"]);
    expect(readRecentColors()).toEqual(["#00ff00", "#ff0000"]);
  });

  it("ignores damaged or unreadable storage", () => {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(["#ff0000", 4, "blue", "#FF0000"]));
    expect(readRecentColors()).toEqual(["#ff0000"]);

    localStorage.setItem(RECENT_COLORS_KEY, "{not json");
    expect(readRecentColors()).toEqual([]);

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => useRecentColors.getState().push("#0000ff")).not.toThrow();
    expect(useRecentColors.getState().colors[0]).toBe("#0000ff");
  });
});
