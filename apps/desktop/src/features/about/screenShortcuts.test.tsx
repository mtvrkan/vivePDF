import { describe, expect, it } from "vitest";
import { isShortcutSheetKey, shortcutGroupsFor, shortcutScreen } from "./screenShortcuts";

const key = (init: KeyboardEventInit, target?: HTMLElement) => {
  const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
  if (target) Object.defineProperty(event, "target", { value: target });
  return event;
};

describe("shortcutScreen", () => {
  it("picks the screen from the route, the presentation and the Studio editor in use", () => {
    expect(shortcutScreen("/viewer", false, null)).toBe("viewer");
    expect(shortcutScreen("/viewer", true, null)).toBe("presentation");
    expect(shortcutScreen("/pages", false, null)).toBe("pages");
    expect(shortcutScreen("/studio", false, "design")).toBe("studioDesign");
    expect(shortcutScreen("/studio", false, "document")).toBe("studioDocument");
  });

  it("falls back to the shortcuts every screen shares on the Studio start page and elsewhere", () => {
    expect(shortcutScreen("/studio", false, null)).toBe("general");
    expect(shortcutScreen("/tools/merge", false, "design")).toBe("general");
    expect(shortcutGroupsFor("general").map((group) => group.id)).toEqual(["global"]);
  });

  it("lists the screen's own group first and keeps the global one", () => {
    expect(shortcutGroupsFor("pages").map((group) => group.id)).toEqual(["organizer", "global"]);
    expect(shortcutGroupsFor("viewer").map((group) => group.id)).toEqual(["viewer", "editor", "presentation", "global"]);
    expect(shortcutGroupsFor("presentation").map((group) => group.id)).toEqual(["presentation"]);
  });
});

describe("isShortcutSheetKey", () => {
  it("opens on F1 and Ctrl+/ but not on modified F1", () => {
    expect(isShortcutSheetKey(key({ key: "F1" }))).toBe(true);
    expect(isShortcutSheetKey(key({ key: "/", ctrlKey: true }))).toBe(true);
    expect(isShortcutSheetKey(key({ key: "/", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isShortcutSheetKey(key({ key: "F1", shiftKey: true }))).toBe(false);
    expect(isShortcutSheetKey(key({ key: "/" }))).toBe(false);
  });

  it("leaves Ctrl+/ to text fields but still answers F1 there", () => {
    const input = document.createElement("input");

    expect(isShortcutSheetKey(key({ key: "/", ctrlKey: true }, input))).toBe(false);
    expect(isShortcutSheetKey(key({ key: "F1" }, input))).toBe(true);
  });

  it("ignores a key another screen already handled", () => {
    const event = key({ key: "F1" });
    event.preventDefault();

    expect(isShortcutSheetKey(event)).toBe(false);
  });
});
