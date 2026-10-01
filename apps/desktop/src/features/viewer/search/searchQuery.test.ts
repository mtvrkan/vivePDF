import { describe, expect, it } from "vitest";
import { effectiveSearchQuery } from "./searchQuery";

describe("effectiveSearchQuery", () => {
  it("searches trimmed queries of two or more characters", () => {
    expect(effectiveSearchQuery("  entropy ")).toBe("entropy");
  });

  it("clears the search for a single latin letter so old highlights go away", () => {
    expect(effectiveSearchQuery("a")).toBe("");
    expect(effectiveSearchQuery("   ")).toBe("");
  });

  it("allows a single Chinese, Japanese or Korean character", () => {
    expect(effectiveSearchQuery("熵")).toBe("熵");
    expect(effectiveSearchQuery("の")).toBe("の");
    expect(effectiveSearchQuery("한")).toBe("한");
  });
});
