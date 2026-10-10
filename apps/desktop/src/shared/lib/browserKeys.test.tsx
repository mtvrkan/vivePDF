import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserKeyGuard, isBrowserShortcut } from "./browserKeys";

function key(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init } as KeyboardEvent;
}

describe("isBrowserShortcut", () => {
  it("catches every WebView reload, find, print and history key", () => {
    const caught = [
      key({ key: "F5" }),
      key({ key: "F5", ctrlKey: true }),
      key({ key: "F5", shiftKey: true }),
      key({ key: "r", ctrlKey: true }),
      key({ key: "R", ctrlKey: true, shiftKey: true }),
      key({ key: "BrowserRefresh" }),
      key({ key: "F3" }),
      key({ key: "f", ctrlKey: true }),
      key({ key: "g", ctrlKey: true }),
      key({ key: "p", ctrlKey: true }),
      key({ key: "s", metaKey: true }),
      key({ key: "F7" }),
      key({ key: "ArrowLeft", altKey: true }),
      key({ key: "BrowserBack" }),
    ];
    expect(caught.every((event) => isBrowserShortcut(event))).toBe(true);
  });

  it("leaves editing, clipboard and app keys alone", () => {
    const free = [
      key({ key: "c", ctrlKey: true }),
      key({ key: "v", ctrlKey: true }),
      key({ key: "z", ctrlKey: true }),
      key({ key: "b", ctrlKey: true }),
      key({ key: "u", ctrlKey: true }),
      key({ key: "o", ctrlKey: true }),
      key({ key: "k", ctrlKey: true }),
      key({ key: "F11" }),
      key({ key: "r" }),
      key({ key: "ArrowLeft" }),
      key({ key: "r", ctrlKey: true, altKey: true }),
    ];
    expect(free.some((event) => isBrowserShortcut(event))).toBe(false);
  });

  it("keeps developer tools reachable only when asked", () => {
    expect(isBrowserShortcut(key({ key: "F12" }))).toBe(true);
    expect(isBrowserShortcut(key({ key: "I", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isBrowserShortcut(key({ key: "F12" }), true)).toBe(false);
    expect(isBrowserShortcut(key({ key: "I", ctrlKey: true, shiftKey: true }), true)).toBe(false);
  });
});

describe("isBrowserShortcut on macOS", () => {
  it("lets Command+H reach the system Hide command", () => {
    expect(isBrowserShortcut(key({ key: "h", metaKey: true }), false, true)).toBe(false);
    expect(isBrowserShortcut(key({ key: "h", metaKey: true }), false, false)).toBe(true);
    expect(isBrowserShortcut(key({ key: "h", ctrlKey: true }), false, true)).toBe(true);
    expect(isBrowserShortcut(key({ key: "H", metaKey: true, shiftKey: true }), false, true)).toBe(true);
  });
});

describe("installBrowserKeyGuard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cancels the browser action but still lets the app hear the key", () => {
    const remove = installBrowserKeyGuard(false);
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    const reload = new KeyboardEvent("keydown", { key: "F5", cancelable: true });
    window.dispatchEvent(reload);
    const copy = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, cancelable: true });
    window.dispatchEvent(copy);
    expect(reload.defaultPrevented).toBe(true);
    expect(copy.defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener("keydown", heard);
    remove();
    const after = new KeyboardEvent("keydown", { key: "F5", cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
