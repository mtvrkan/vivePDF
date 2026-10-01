import { describe, expect, it } from "vitest";
import { pdfaCheckState } from "./pdfaCheckState";

describe("pdfaCheckState", () => {
  it("separates passed, fixable and blocking checks", () => {
    expect(pdfaCheckState({ status: "pass", fixable: false })).toBe("pass");
    expect(pdfaCheckState({ status: "fail", fixable: true })).toBe("fixable");
    expect(pdfaCheckState({ status: "fail", fixable: false })).toBe("blocking");
  });
});
