import { describe, expect, it } from "vitest";
import { tesseractLanguageName } from "./locales";

describe("tesseractLanguageName", () => {
  it("names a language in the interface language", () => {
    expect(tesseractLanguageName("deu", "tr")).toBe("Almanca");
    expect(tesseractLanguageName("tur", "en")).toBe("Turkish");
  });

  it("keeps the two Chinese scripts apart", () => {
    expect(tesseractLanguageName("chi_sim", "en")).not.toBe(tesseractLanguageName("chi_tra", "en"));
  });

  it("falls back for unknown codes", () => {
    expect(tesseractLanguageName("xyz", "en")).toBe("xyz");
    expect(tesseractLanguageName("xyz", "en", "Other")).toBe("Other");
  });
});
