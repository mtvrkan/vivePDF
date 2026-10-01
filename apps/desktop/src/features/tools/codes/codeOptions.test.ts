import { describe, expect, it } from "vitest";
import { withinRange } from "@/shared/lib/numberRange";
import { levelFor, levelsFor, SIZE_MM } from "./codeOptions";

describe("error correction levels", () => {
  it("offers all four levels only for QR", () => {
    expect(levelsFor("qr")).toEqual(["L", "M", "Q", "H"]);
    expect(levelsFor("microQr")).toEqual(["L", "M", "Q"]);
  });

  it("offers no level for codes that do not use one", () => {
    expect(levelsFor("dataMatrix")).toEqual([]);
    expect(levelsFor("code128")).toEqual([]);
  });

  it("lowers H to Q when switching to Micro QR", () => {
    expect(levelFor("microQr", "H")).toBe("Q");
    expect(levelFor("microQr", "M")).toBe("M");
    expect(levelFor("qr", "H")).toBe("H");
  });
});

describe("size limits", () => {
  it("accepts sizes inside the range", () => {
    expect(withinRange(9, SIZE_MM)).toBe(true);
    expect(withinRange(140, SIZE_MM)).toBe(true);
  });

  it("rejects sizes the engine refuses and empty inputs", () => {
    expect(withinRange(8, SIZE_MM)).toBe(false);
    expect(withinRange(141, SIZE_MM)).toBe(false);
    expect(withinRange(Number.NaN, SIZE_MM)).toBe(false);
  });
});
