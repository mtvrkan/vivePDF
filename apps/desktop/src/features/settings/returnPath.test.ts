import { describe, expect, it } from "vitest";
import { isInAppPath } from "./returnPath";

describe("isInAppPath", () => {
  it("accepts an in-app route", () => {
    expect(isInAppPath("/viewer")).toBe(true);
    expect(isInAppPath("/viewer?page=3")).toBe(true);
    expect(isInAppPath("/")).toBe(true);
  });

  it("rejects a protocol-relative url", () => {
    expect(isInAppPath("//evil.example")).toBe(false);
  });

  it("rejects a backslash-escaped host", () => {
    expect(isInAppPath("/\\evil.example")).toBe(false);
  });

  it("rejects an absolute url and a bare path", () => {
    expect(isInAppPath("https://evil.example")).toBe(false);
    expect(isInAppPath("viewer")).toBe(false);
    expect(isInAppPath("")).toBe(false);
  });
});
