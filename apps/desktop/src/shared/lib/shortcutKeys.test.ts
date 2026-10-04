import { describe, expect, it } from "vitest";
import { bracketKey, digitKey, shortcutLetter, zoomKey } from "./shortcutKeys";

describe("shortcutLetter", () => {
  it("reads Latin letters from the typed key", () => {
    expect(shortcutLetter({ key: "B", code: "KeyB" })).toBe("b");
    expect(shortcutLetter({ key: "s", code: "KeyS" })).toBe("s");
  });

  it("treats the Turkish dotless and dotted capital I as i", () => {
    expect(shortcutLetter({ key: "ı", code: "KeyI" })).toBe("i");
    expect(shortcutLetter({ key: "İ", code: "Quote" })).toBe("i");
  });

  it("falls back to the physical key only for non-Latin letters", () => {
    expect(shortcutLetter({ key: "с", code: "KeyC" })).toBe("c");
    expect(shortcutLetter({ key: "ğ", code: "BracketLeft" })).toBeNull();
    expect(shortcutLetter({ key: "*", code: "Minus" })).toBeNull();
  });
});

describe("zoomKey", () => {
  it("follows the typed symbol before the physical key", () => {
    expect(zoomKey({ key: "-", code: "Equal" })).toBe("out");
    expect(zoomKey({ key: "+", code: "Digit4" })).toBe("in");
    expect(zoomKey({ key: "*", code: "Minus" })).toBeNull();
  });

  it("uses the physical key when the layout types no symbol", () => {
    expect(zoomKey({ key: "Unidentified", code: "Equal" })).toBe("in");
    expect(zoomKey({ key: "Unidentified", code: "Numpad0" })).toBe("zero");
  });
});

describe("bracketKey", () => {
  it("accepts the bracket position on any layout but never AltGr", () => {
    expect(bracketKey({ key: "ü", code: "BracketRight", altKey: false })).toBe("right");
    expect(bracketKey({ key: "[", code: "BracketLeft", altKey: false })).toBe("left");
    expect(bracketKey({ key: "[", code: "Digit8", altKey: true })).toBeNull();
  });
});

describe("digitKey", () => {
  it("reads digits typed with or without Shift", () => {
    expect(digitKey({ key: "1", code: "Digit1" })).toBe(1);
    expect(digitKey({ key: "!", code: "Digit1" })).toBe(1);
    expect(digitKey({ key: "a", code: "KeyA" })).toBeNull();
  });
});
