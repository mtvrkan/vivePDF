import { describe, expect, it } from "vitest";
import { DEFAULT_OUTPUT_PATTERN, outputFileName, patternIsValid, renderName, sanitizeFileName } from "./naming";

describe("naming", () => {
  it("renders tokens and keeps unknown ones literal", () => {
    const now = new Date(2026, 8, 5, 14, 7, 9);
    expect(renderName("{name}-{suffix}", { name: "report", suffix: "compressed" }, now)).toBe("report-compressed");
    expect(renderName("{date} {name}", { name: "report" }, now)).toBe("2026-09-05 report");
    expect(renderName("{time}_{year}", {}, now)).toBe("14-07-09_2026");
    expect(renderName("{nope}-{name}", { name: "a" }, now)).toBe("{nope}-a");
  });

  it("sanitizes names and collapses leftover separators", () => {
    expect(sanitizeFileName('a/b:c?"d')).toBe("a-b-c-d");
    expect(sanitizeFileName("report-")).toBe("report");
    expect(sanitizeFileName("  --x--  ")).toBe("x");
    expect(sanitizeFileName("")).toBe("output");
  });

  it("falls back to the default pattern when the pattern is unusable", () => {
    expect(patternIsValid("{suffix}")).toBe(false);
    expect(patternIsValid(DEFAULT_OUTPUT_PATTERN)).toBe(true);
    expect(outputFileName("scan", "ocr", "{suffix}")).toBe("scan-ocr");
    expect(outputFileName("scan", "", "{name}-{suffix}")).toBe("scan");
    expect(outputFileName("scan", "ocr", "{suffix}_{name}")).toBe("ocr_scan");
  });
});
