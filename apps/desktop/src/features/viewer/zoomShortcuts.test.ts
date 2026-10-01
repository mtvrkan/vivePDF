import { describe, expect, it } from "vitest";
import { parseZoomPercent, wheelZoomFactor, zoomShortcutFor } from "./zoomShortcuts";

const press = (key: string, code: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key,
  code,
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  ...extra,
});

describe("zoomShortcutFor", () => {
  it("maps plus and minus across keyboard layouts", () => {
    expect(zoomShortcutFor(press("=", "Equal"))).toBe("in");
    expect(zoomShortcutFor(press("+", "Digit4"))).toBe("in");
    expect(zoomShortcutFor(press("+", "NumpadAdd"))).toBe("in");
    expect(zoomShortcutFor(press("-", "Minus"))).toBe("out");
    expect(zoomShortcutFor(press("-", "NumpadSubtract"))).toBe("out");
  });

  it("maps digits to zoom modes and ignores keys without a modifier", () => {
    expect(zoomShortcutFor(press("0", "Digit0"))).toBe("actualSize");
    expect(zoomShortcutFor(press("1", "Digit1"))).toBe("fitWidth");
    expect(zoomShortcutFor(press("2", "Digit2"))).toBe("fitPage");
    expect(zoomShortcutFor(press("=", "Equal", { ctrlKey: false }))).toBeNull();
    expect(zoomShortcutFor(press("=", "Equal", { altKey: true }))).toBeNull();
    expect(zoomShortcutFor(press("k", "KeyK"))).toBeNull();
  });
});

describe("parseZoomPercent", () => {
  it("accepts loose input and clamps to the supported range", () => {
    expect(parseZoomPercent("137%")).toBe(137);
    expect(parseZoomPercent(" 150 ")).toBe(150);
    expect(parseZoomPercent("12,5")).toBe(25);
    expect(parseZoomPercent("9999")).toBe(800);
    expect(parseZoomPercent("abc")).toBeNull();
    expect(parseZoomPercent("")).toBeNull();
  });
});

describe("wheelZoomFactor", () => {
  it("scales one notch to a gentle step and caps large deltas", () => {
    expect(wheelZoomFactor(-120)).toBeCloseTo(1.24, 2);
    expect(wheelZoomFactor(120) * wheelZoomFactor(-120)).toBeCloseTo(1, 5);
    expect(wheelZoomFactor(-5000)).toBeCloseTo(Math.exp(0.5), 5);
    expect(wheelZoomFactor(0)).toBe(1);
  });
});
