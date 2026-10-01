import { describe, expect, it } from "vitest";
import { fileNameFromUrl } from "./urlName";

describe("file name from a web address", () => {
  it("joins the host with the last path segment", () => {
    expect(fileNameFromUrl("https://tr.wikipedia.org/wiki/PDF")).toBe("tr.wikipedia.org-PDF");
  });

  it("drops www, the extension and the query", () => {
    expect(fileNameFromUrl("https://www.example.com/blog/yazi.html?x=1")).toBe("example.com-yazi");
  });

  it("accepts an address without a scheme and falls back to the host alone", () => {
    expect(fileNameFromUrl("example.com")).toBe("example.com");
  });

  it("decodes percent escapes and replaces separators", () => {
    expect(fileNameFromUrl("https://example.com/a/%C3%A7ay_demleme")).toBe("example.com-çay-demleme");
  });

  it("returns nothing for an empty or unusable address", () => {
    expect(fileNameFromUrl("")).toBe("");
    expect(fileNameFromUrl("javascript:alert(1)")).toBe("");
    expect(fileNameFromUrl("   ")).toBe("");
  });
});
