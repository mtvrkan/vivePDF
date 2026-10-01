import { describe, expect, it } from "vitest";
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, knownDateFormat } from "./dateFormats";

describe("knownDateFormat", () => {
  it("keeps a listed format", () => {
    expect(knownDateFormat("%Y-%m-%d")).toBe("%Y-%m-%d");
  });

  it("falls back to the default for missing or unknown values", () => {
    expect(knownDateFormat(undefined)).toBe(DEFAULT_DATE_FORMAT);
    expect(knownDateFormat("%A %H")).toBe(DEFAULT_DATE_FORMAT);
    expect(DATE_FORMATS[0].value).toBe(DEFAULT_DATE_FORMAT);
  });
});
