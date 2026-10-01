import { describe, expect, it } from "vitest";
import { formatRelativeMoment, toolMatches } from "./homeSearch";
import { toolShortcuts } from "@/app/navigation";

describe("toolMatches", () => {
  const merge = toolShortcuts.find((tool) => tool.id === "merge")!;

  it("matches by keyword regardless of group filter when group is all", () => {
    expect(toolMatches(merge, "combine", "en", "Merge", "Combine PDFs", "all")).toBe(true);
  });

  it("excludes tools outside the selected group", () => {
    expect(toolMatches(merge, "", "en", "Merge", "Combine PDFs", "security")).toBe(false);
  });

  it("returns false when the query does not match label, description, or keywords", () => {
    expect(toolMatches(merge, "xyz123", "en", "Merge", "Combine PDFs", "all")).toBe(false);
  });
});

describe("formatRelativeMoment", () => {
  const now = new Date("2026-09-09T12:00:00Z").getTime();

  it("formats a recent timestamp using relative units", () => {
    expect(formatRelativeMoment(now - 2 * 60 * 60 * 1000, "en", now)).toBe("2 hours ago");
  });

  it("falls back to a date string for timestamps older than a week", () => {
    const old = now - 10 * 24 * 60 * 60 * 1000;
    expect(formatRelativeMoment(old, "en", now)).toBe(new Date(old).toLocaleDateString("en", { dateStyle: "medium" }));
  });
});

describe("formatRelativeMoment, a moment ago", () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);

  it("says just now instead of naming the current minute", () => {
    expect(formatRelativeMoment(now - 20 * 1000, "en", now, "just now")).toBe("just now");
    expect(formatRelativeMoment(now, "tr", now, "az önce")).toBe("az önce");
  });

  it("goes back to counting once a minute has passed", () => {
    expect(formatRelativeMoment(now - 3 * 60 * 1000, "en", now, "just now")).toBe("3 minutes ago");
  });

  it("leaves the wording alone when no label is given", () => {
    expect(formatRelativeMoment(now - 20 * 1000, "en", now)).toBe("this minute");
  });
});
