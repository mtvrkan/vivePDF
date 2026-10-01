import { describe, expect, it } from "vitest";
import { preflightDetailKey } from "./checkDetail";

describe("preflightDetailKey", () => {
  it("uses the no-images message when a document has no images to list", () => {
    expect(preflightDetailKey({ id: "colorSpaces", status: "pass", value: null })).toBe("tools.preflight.checks.colorSpaces.none");
    expect(preflightDetailKey({ id: "colorSpaces", status: "pass", value: "" })).toBe("tools.preflight.checks.colorSpaces.none");
  });

  it("keeps the status message when colour spaces were found", () => {
    expect(preflightDetailKey({ id: "colorSpaces", status: "pass", value: "RGB 3" })).toBe("tools.preflight.checks.colorSpaces.pass");
    expect(preflightDetailKey({ id: "colorSpaces", status: "fail", value: "RGB 3" })).toBe("tools.preflight.checks.colorSpaces.fail");
  });

  it("uses the no-colour message when no vector art or text sets a colour", () => {
    expect(preflightDetailKey({ id: "vectorColors", status: "pass", value: null, count: 0 })).toBe("tools.preflight.checks.vectorColors.none");
    expect(preflightDetailKey({ id: "vectorColors", status: "fail", value: "RGB 3", count: 3 })).toBe("tools.preflight.checks.vectorColors.fail");
  });

  it("uses the variant message when the check names one", () => {
    expect(preflightDetailKey({ id: "transparency", status: "pass", count: 2, variant: "allowed" })).toBe("tools.preflight.checks.transparency.allowed");
    expect(preflightDetailKey({ id: "pdfVersion", status: "fail", value: "1.7", variant: "x1a" })).toBe("tools.preflight.checks.pdfVersion.x1a");
  });

  it("maps every other check to its status message", () => {
    expect(preflightDetailKey({ id: "fonts", status: "warn", count: 2 })).toBe("tools.preflight.checks.fonts.warn");
  });
});
