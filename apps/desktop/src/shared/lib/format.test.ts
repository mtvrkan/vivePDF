import { describe, expect, it } from "vitest";
import { formatBytes, formatPageSize, formatPdfDate, pageSizesAreUniform, parsePdfDate } from "./format";

describe("formatBytes", () => {
  it("formats bytes below 1 KB without decimals", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
  });

  it("formats megabytes with one decimal above 10", () => {
    expect(formatBytes(26_866_656, "en")).toBe("25.6 MB");
  });

  it("returns a dash for invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatPageSize", () => {
  it("converts A4 points to millimetres", () => {
    expect(formatPageSize({ width: 595.276, height: 841.89, rotation: 0 })).toBe("210 × 297 mm");
  });
});

describe("pageSizesAreUniform", () => {
  it("is true for an empty list and identical sizes", () => {
    expect(pageSizesAreUniform([])).toBe(true);
    const a4 = { width: 595, height: 842, rotation: 0 };
    expect(pageSizesAreUniform([a4, { ...a4 }])).toBe(true);
  });

  it("is false when a page differs", () => {
    expect(
      pageSizesAreUniform([
        { width: 595, height: 842, rotation: 0 },
        { width: 612, height: 792, rotation: 0 },
      ]),
    ).toBe(false);
  });
});

describe("parsePdfDate", () => {
  it("parses UTC dates", () => {
    expect(parsePdfDate("D:20231127095643Z")?.toISOString()).toBe("2023-11-27T09:56:43.000Z");
  });

  it("applies timezone offsets", () => {
    expect(parsePdfDate("D:20240102120000+03'00'")?.toISOString()).toBe("2024-01-02T09:00:00.000Z");
  });

  it("accepts a date with only a year and month", () => {
    expect(parsePdfDate("D:202405")?.toISOString()).toBe("2024-05-01T00:00:00.000Z");
  });

  it("returns null for non-PDF dates and echoes the raw value when formatting", () => {
    expect(parsePdfDate("yesterday")).toBeNull();
    expect(formatPdfDate("yesterday")).toBe("yesterday");
  });
});
