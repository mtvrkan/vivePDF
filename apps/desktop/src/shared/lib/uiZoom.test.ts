import { beforeEach, describe, expect, it, vi } from "vitest";
import { UI_ZOOMS, applyInterfaceScale, resetUiZoomDetection, rootFontScale, rootFontSize, stepUiZoom, uiZoomShortcutFor } from "./uiZoom";

const key = (init: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }>) => ({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, ...init });

beforeEach(() => {
  resetUiZoomDetection();
});

describe("uiZoomShortcutFor", () => {
  it("maps Ctrl/Cmd with =, +, -, 0 and the numpad keys", () => {
    expect(uiZoomShortcutFor(key({ key: "=", code: "Equal", ctrlKey: true }))).toBe("in");
    expect(uiZoomShortcutFor(key({ key: "+", code: "Equal", metaKey: true }))).toBe("in");
    expect(uiZoomShortcutFor(key({ key: "+", code: "NumpadAdd", ctrlKey: true }))).toBe("in");
    expect(uiZoomShortcutFor(key({ key: "-", code: "Minus", ctrlKey: true }))).toBe("out");
    expect(uiZoomShortcutFor(key({ key: "0", code: "Digit0", ctrlKey: true }))).toBe("reset");
  });

  it("ignores plain keys and unrelated shortcuts", () => {
    expect(uiZoomShortcutFor(key({ key: "=", code: "Equal" }))).toBeNull();
    expect(uiZoomShortcutFor(key({ key: "s", code: "KeyS", ctrlKey: true }))).toBeNull();
  });

  it("maps Ctrl + Alt with =, +, - and 0 so the interface zooms where Ctrl alone zooms the page", () => {
    expect(uiZoomShortcutFor(key({ key: "=", code: "Equal", ctrlKey: true, altKey: true }))).toBe("in");
    expect(uiZoomShortcutFor(key({ key: "+", code: "NumpadAdd", ctrlKey: true, altKey: true }))).toBe("in");
    expect(uiZoomShortcutFor(key({ key: "-", code: "Minus", ctrlKey: true, altKey: true }))).toBe("out");
    expect(uiZoomShortcutFor(key({ key: "0", code: "Digit0", metaKey: true, altKey: true }))).toBe("reset");
  });

  it("does not treat AltGr characters on the same physical keys as zoom", () => {
    expect(uiZoomShortcutFor(key({ key: "}", code: "Digit0", ctrlKey: true, altKey: true }))).toBeNull();
    expect(uiZoomShortcutFor(key({ key: "|", code: "Minus", ctrlKey: true, altKey: true }))).toBeNull();
    expect(uiZoomShortcutFor(key({ key: "}", code: "Equal", ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe("stepUiZoom", () => {
  it("walks the fixed steps and clamps at both ends", () => {
    expect(stepUiZoom(1, "in")).toBe(1.1);
    expect(stepUiZoom(1.1, "in")).toBe(1.25);
    expect(stepUiZoom(1, "out")).toBe(0.9);
    expect(stepUiZoom(2, "in")).toBe(2);
    expect(stepUiZoom(0.8, "out")).toBe(0.8);
    expect(stepUiZoom(1.75, "reset")).toBe(1);
    expect(UI_ZOOMS).toContain(2);
  });
});

describe("applyInterfaceScale", () => {
  it("uses the webview zoom when it is allowed and leaves the root font to the scale setting", async () => {
    const root = { style: { fontSize: "" } };
    const setZoom = vi.fn(async () => undefined);
    await applyInterfaceScale(root, 110, 1.5, { setZoom });
    expect(setZoom).toHaveBeenCalledWith(1.5);
    expect(root.style.fontSize).toBe("110%");
    expect(rootFontSize(100, 2)).toBe("");
    expect(rootFontScale(110, 1.5)).toBe(1.1);
    expect(rootFontScale(100, 2)).toBe(1);
  });

  it("falls back to scaling the root font when the webview refuses the zoom", async () => {
    const root = { style: { fontSize: "" } };
    const setZoom = vi.fn(async () => {
      throw new Error("core:webview:allow-set-webview-zoom not allowed");
    });
    await applyInterfaceScale(root, 110, 1.5, { setZoom });
    expect(root.style.fontSize).toBe("165%");
    await applyInterfaceScale(root, 100, 2, { setZoom });
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(root.style.fontSize).toBe("200%");
    await applyInterfaceScale(root, 100, 1, { setZoom });
    expect(root.style.fontSize).toBe("");
  });

  it("falls back when there is no webview at all", async () => {
    const root = { style: { fontSize: "" } };
    await applyInterfaceScale(root, 90, 1.25, null);
    expect(root.style.fontSize).toBe("113%");
  });

  it("lets the latest call win when zoom requests overlap", async () => {
    const root = { style: { fontSize: "" } };
    let release: () => void = () => undefined;
    const slow = { setZoom: vi.fn(() => new Promise<void>((resolve) => (release = resolve))) };
    const first = applyInterfaceScale(root, 120, 1, slow);
    const second = applyInterfaceScale(root, 90, 1, { setZoom: async () => undefined });
    await second;
    release();
    await first;
    expect(root.style.fontSize).toBe("90%");
  });
});
