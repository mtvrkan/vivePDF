import { describe, expect, it } from "vitest";
import { ariaShortcut, hasModKey, isFullscreenKey, shortcutLabel } from "./platform";

const mac = (text: string) => shortcutLabel(text, true);

describe("shortcutLabel", () => {
  it("returns the text untouched off macOS", () => {
    for (const text of ["Ctrl+Shift+S", "Ctrl Wheel", "Ctrl/Shift-click", "Alt+↑", "Shift R  /  Ctrl R"]) expect(shortcutLabel(text, false)).toBe(text);
  });

  it("folds modifier runs into canonical mac symbols", () => {
    expect(mac("Ctrl+Shift+S")).toBe("⇧⌘S");
    expect(mac("Ctrl Shift S  /  Ctrl Shift S")).toBe("⇧⌘S  /  ⇧⌘S");
    expect(mac("Ctrl Alt C")).toBe("⌥⌘C");
    expect(mac("Shift+Ctrl+Z")).toBe("⇧⌘Z");
    expect(mac("Shift R  /  Ctrl R")).toBe("⇧R  /  ⌘R");
    expect(mac("Ctrl Shift L  /  E  /  R")).toBe("⇧⌘L  /  E  /  R");
    expect(mac("Ctrl Alt 1  /  2  /  3")).toBe("⌥⌘1  /  2  /  3");
  });

  it("handles symbol keys and spaced plus signs", () => {
    expect(mac("Ctrl++")).toBe("⌘+");
    expect(mac("Ctrl+-")).toBe("⌘-");
    expect(mac("Ctrl +  /  Ctrl −  ·  Ctrl Wheel")).toBe("⌘+  /  ⌘−  ·  ⌘ Wheel");
    expect(mac("Ctrl + = / Ctrl + − / Ctrl + 0")).toBe("⌘= / ⌘− / ⌘0");
    expect(mac("(Ctrl + Alt + =)")).toBe("(⌥⌘=)");
    expect(mac("Ctrl Shift ↑  /  Ctrl Shift ↓")).toBe("⇧⌘↑  /  ⇧⌘↓");
    expect(mac("Ctrl+{wheel} / Ctrl +/−")).toBe("⌘ {wheel} / ⌘+/−");
    expect(mac("Ctrl ↵")).toBe("⌘↵");
  });

  it("maps Enter and arrow names to symbols and spaces word keys", () => {
    expect(mac("Ctrl+Enter")).toBe("⌘↩");
    expect(mac("Write a reply… (Ctrl+Enter sends)")).toBe("Write a reply… (⌘↩ sends)");
    expect(mac("Strg+Eingabe sendet")).toBe("⌘↩ sendet");
    expect(mac("Shift+Enter")).toBe("⇧↩");
    expect(mac("Alt+ArrowUp")).toBe("⌥↑");
    expect(mac("Ctrl Drag")).toBe("⌘ Drag");
    expect(mac("Shift Tab")).toBe("⇧ Tab");
    expect(mac("F5  /  Shift F5")).toBe("F5  /  ⇧F5");
    expect(mac("Shift+F10")).toBe("⇧F10");
  });

  it("rewrites prose without touching unrelated words", () => {
    expect(mac("Ctrl/Shift-click")).toBe("⌘/Shift-click");
    expect(mac("(Ctrl toggles, Shift adds)")).toBe("(⌘ toggles, Shift adds)");
    expect(mac("press Alt+↑ or Alt+↓ on it")).toBe("press ⌥↑ or ⌥↓ on it");
    expect(mac("Press Ctrl+V on any page")).toBe("Press ⌘V on any page");
    expect(mac("Ctrl+V'ye basın")).toBe("⌘V'ye basın");
    expect(mac("add Alt (Ctrl + Alt + =) to zoom")).toBe("add Alt (⌥⌘=) to zoom");
    expect(mac("Shift+click sets every page")).toBe("Shift+click sets every page");
    for (const text of ["Alt text", "Alternate", "Alt (tam genişlik)", "Alt orta", "Maj : 10 pt", "Majuscules", "Shift: 10 pt", "with Shift 5 mm", "Ctrlx"]) expect(mac(text)).toBe(text);
  });
});

describe("ariaShortcut", () => {
  it("swaps Control for Meta on macOS only", () => {
    expect(ariaShortcut("Control+Shift+ArrowLeft Control+Alt+C", true)).toBe("Meta+Shift+ArrowLeft Meta+Alt+C");
    expect(ariaShortcut("Control+Shift+ArrowLeft", false)).toBe("Control+Shift+ArrowLeft");
  });
});

describe("hasModKey", () => {
  it("accepts Command only on macOS", () => {
    expect(hasModKey({ ctrlKey: true, metaKey: false }, false)).toBe(true);
    expect(hasModKey({ ctrlKey: false, metaKey: true }, false)).toBe(false);
    expect(hasModKey({ ctrlKey: false, metaKey: true }, true)).toBe(true);
  });
});

describe("isFullscreenKey", () => {
  it("takes F11 everywhere and Control Command F on macOS", () => {
    expect(isFullscreenKey({ key: "F11", ctrlKey: false, metaKey: false }, false)).toBe(true);
    expect(isFullscreenKey({ key: "f", ctrlKey: true, metaKey: true }, false)).toBe(false);
    expect(isFullscreenKey({ key: "f", ctrlKey: true, metaKey: true }, true)).toBe(true);
    expect(isFullscreenKey({ key: "f", ctrlKey: false, metaKey: true }, true)).toBe(false);
  });
});
