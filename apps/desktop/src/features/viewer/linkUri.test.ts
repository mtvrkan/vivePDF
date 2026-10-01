import { describe, expect, it } from "vitest";
import { isOpenableUri, normalizeLinkUri } from "./linkUri";

describe("normalizeLinkUri", () => {
  it("keeps an http and https address", () => {
    expect(normalizeLinkUri("https://example.com/a")).toBe("https://example.com/a");
    expect(normalizeLinkUri("http://example.com/")).toBe("http://example.com/");
  });

  it("assumes https when no scheme is given", () => {
    expect(normalizeLinkUri("example.com/page")).toBe("https://example.com/page");
    expect(normalizeLinkUri("  example.com  ")).toBe("https://example.com/");
  });

  it("rejects a dangerous scheme", () => {
    expect(normalizeLinkUri("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUri("file:///C:/Windows/System32")).toBeNull();
    expect(normalizeLinkUri("ms-msdt:/id")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeLinkUri("")).toBeNull();
    expect(normalizeLinkUri("   ")).toBeNull();
  });
});

describe("isOpenableUri", () => {
  it("accepts only http and https", () => {
    expect(isOpenableUri("https://example.com")).toBe(true);
    expect(isOpenableUri("http://example.com")).toBe(true);
    expect(isOpenableUri("file:///etc/passwd")).toBe(false);
    expect(isOpenableUri("javascript:alert(1)")).toBe(false);
    expect(isOpenableUri("not a url")).toBe(false);
  });
});
