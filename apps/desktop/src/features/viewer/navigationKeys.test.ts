import { describe, expect, it } from "vitest";
import { findAgainKey, historyKey } from "./navigationKeys";

function key(init: Partial<KeyboardEvent> & { code?: string }) {
  return { key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init };
}

describe("findAgainKey", () => {
  it("steps through results with F3 everywhere and Command G on macOS", () => {
    expect(findAgainKey(key({ key: "F3" }), false)).toBe("next");
    expect(findAgainKey(key({ key: "F3", shiftKey: true }), true)).toBe("previous");
    expect(findAgainKey(key({ key: "g", metaKey: true }), true)).toBe("next");
    expect(findAgainKey(key({ key: "G", metaKey: true, shiftKey: true }), true)).toBe("previous");
  });

  it("finds the G key by position when the layout types another letter there", () => {
    expect(findAgainKey(key({ key: "ı", code: "KeyG", metaKey: true }), true)).toBe("next");
  });

  it("leaves Control G and Windows' Command-less G alone", () => {
    expect(findAgainKey(key({ key: "g", ctrlKey: true }), true)).toBeNull();
    expect(findAgainKey(key({ key: "g", metaKey: true }), false)).toBeNull();
    expect(findAgainKey(key({ key: "F3", ctrlKey: true }), false)).toBeNull();
  });
});

describe("historyKey", () => {
  it("goes back and forward with Alt arrows and, on macOS, Command brackets", () => {
    expect(historyKey(key({ key: "ArrowLeft", altKey: true }), false)).toBe("back");
    expect(historyKey(key({ key: "ArrowRight", altKey: true }), true)).toBe("forward");
    expect(historyKey(key({ key: "[", metaKey: true }), true)).toBe("back");
    expect(historyKey(key({ key: "ğ", code: "BracketLeft", metaKey: true }), true)).toBe("back");
    expect(historyKey(key({ key: "]", metaKey: true }), true)).toBe("forward");
  });

  it("ignores the brackets off macOS and any shifted or Control combination", () => {
    expect(historyKey(key({ key: "[", metaKey: true }), false)).toBeNull();
    expect(historyKey(key({ key: "[", ctrlKey: true }), true)).toBeNull();
    expect(historyKey(key({ key: "ArrowLeft", altKey: true, shiftKey: true }), false)).toBeNull();
  });
});
