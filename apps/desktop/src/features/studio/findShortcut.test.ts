import { describe, expect, it } from "vitest";
import { findShortcut } from "./findShortcut";

const keys = (init: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey">>) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });

describe("findShortcut", () => {
  it("opens find with Ctrl F on Windows and Command F on macOS", () => {
    expect(findShortcut(keys({ ctrlKey: true }), "f", false)).toBe("find");
    expect(findShortcut(keys({ metaKey: true }), "f", true)).toBe("find");
  });

  it("leaves Command H to the system Hide command on macOS and uses Option Command F for replace", () => {
    expect(findShortcut(keys({ metaKey: true }), "h", true)).toBeNull();
    expect(findShortcut(keys({ metaKey: true, altKey: true }), "f", true)).toBe("replace");
    expect(findShortcut(keys({ ctrlKey: true }), "h", false)).toBe("replace");
  });

  it("ignores Control on macOS, shifted keys and other letters", () => {
    expect(findShortcut(keys({ ctrlKey: true }), "f", true)).toBeNull();
    expect(findShortcut(keys({ ctrlKey: true, shiftKey: true }), "f", false)).toBeNull();
    expect(findShortcut(keys({ ctrlKey: true }), "g", false)).toBeNull();
  });
});
