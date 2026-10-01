import { describe, expect, it } from "vitest";
import { typedSize } from "./markParams";
import { WATERMARK_POSITIONS, presetChoice, presetColor, presetFlag, presetNumber, presetText } from "./markPresetStore";

describe("mark preset values", () => {
  it("keeps valid values from a saved preset", () => {
    expect(presetNumber(72, 4, 400, 48)).toBe(72);
    expect(presetChoice("tile", WATERMARK_POSITIONS, "center")).toBe("tile");
    expect(presetColor("#1E8449", "#000000")).toBe("#1E8449");
    expect(presetFlag(false, true)).toBe(false);
    expect(presetText("TASLAK", "")).toBe("TASLAK");
  });

  it("clamps numbers that are out of range", () => {
    expect(presetNumber(900, 4, 400, 48)).toBe(400);
    expect(presetNumber(-3, 4, 400, 48)).toBe(4);
  });

  it("falls back when a stored value is broken or of the wrong type", () => {
    expect(presetNumber("72", 4, 400, 48)).toBe(48);
    expect(presetNumber(Number.NaN, 4, 400, 48)).toBe(48);
    expect(presetChoice("middle", WATERMARK_POSITIONS, "center")).toBe("center");
    expect(presetColor("red", "#c00000")).toBe("#c00000");
    expect(presetFlag("yes", true)).toBe(true);
    expect(presetText(12, "")).toBe("");
  });
});

describe("typedSize", () => {
  it("uses the default while the field is empty", () => {
    expect(typedSize(0, 4, 400, 48)).toBe(48);
    expect(typedSize(Number.NaN, 4, 400, 48)).toBe(48);
  });

  it("clamps a typed size into the allowed range", () => {
    expect(typedSize(2, 4, 400, 48)).toBe(4);
    expect(typedSize(1000, 6, 200, 28)).toBe(200);
    expect(typedSize(36, 6, 200, 28)).toBe(36);
  });
});
