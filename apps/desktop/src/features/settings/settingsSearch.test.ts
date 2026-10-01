import { describe, expect, it } from "vitest";
import { rowMatches } from "./settingsSearch";

describe("rowMatches", () => {
  it("matches a substring of the label", () => {
    expect(rowMatches("zoom", "Page zoom", "Thumbnail size")).toBe(true);
  });

  it("matches case-insensitively across Turkish İ/I/ı/i", () => {
    expect(rowMatches("İZLE", "izleyici paneli")).toBe(true);
    expect(rowMatches("kapat", "KAPATMA")).toBe(true);
  });

  it("returns true for an empty query and false when nothing matches", () => {
    expect(rowMatches("", "Anything")).toBe(true);
    expect(rowMatches("xyz123", "Page zoom", "Thumbnail size")).toBe(false);
  });
});
