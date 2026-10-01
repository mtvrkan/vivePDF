import { describe, expect, it } from "vitest";
import { PdfErrorCode } from "@embedpdf/models";
import { isPdfPasswordError } from "./pdfPassword";

describe("isPdfPasswordError", () => {
  it("recognises the engine's own reason object", () => {
    expect(isPdfPasswordError({ code: PdfErrorCode.Password, message: "password required" })).toBe(true);
  });

  it("recognises a reason wrapped by a rejected task", () => {
    const rejection = {
      name: "TaskRejectedError",
      reason: { code: PdfErrorCode.Password, message: "FPDF_LoadMemDocument failed" },
    };
    expect(isPdfPasswordError(rejection)).toBe(true);
  });

  it("leaves other engine failures alone", () => {
    expect(isPdfPasswordError({ name: "TaskRejectedError", reason: { code: PdfErrorCode.Unknown } })).toBe(false);
    expect(isPdfPasswordError({ code: PdfErrorCode.NotFound })).toBe(false);
  });

  it("survives anything that is not an error object", () => {
    expect(isPdfPasswordError(null)).toBe(false);
    expect(isPdfPasswordError("password")).toBe(false);
    expect(isPdfPasswordError(undefined)).toBe(false);
  });
});
