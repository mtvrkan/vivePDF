import { describe, expect, it, vi } from "vitest";
import { exitImmersive, setImmersiveFullscreen, shouldExitOnKey } from "./immersive";

const appWindow = vi.hoisted(() => ({
  isMaximized: vi.fn(async () => false),
  outerPosition: vi.fn(async () => ({ x: 10, y: 20 })),
  innerSize: vi.fn(async () => ({ width: 800, height: 600 })),
  unmaximize: vi.fn(async () => {}),
  maximize: vi.fn(async () => {}),
  setFullscreen: vi.fn(async () => {}),
  setPosition: vi.fn(async () => {}),
  setSize: vi.fn(async () => {}),
  setAlwaysOnTop: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => appWindow,
  currentMonitor: async () => null,
  PhysicalPosition: class {},
  PhysicalSize: class {},
}));

vi.mock("@/shared/store/uiStore", () => ({
  useUiStore: { getState: () => ({ setImmersive: () => {}, setImmersiveMounted: () => {} }) },
}));

vi.mock("@/shared/store/presentationStore", () => ({
  usePresentationStore: { getState: () => ({ resetSession: () => {} }) },
}));

const key = (value: string, extra: Partial<{ ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  key: value,
  ctrlKey: false,
  shiftKey: false,
  ...extra,
});

describe("shouldExitOnKey", () => {
  it("exits on F11 while immersive regardless of mount state", () => {
    expect(shouldExitOnKey(key("F11"), { immersive: true, mounted: true })).toBe(true);
    expect(shouldExitOnKey(key("F11"), { immersive: true, mounted: false })).toBe(true);
  });

  it("exits on Escape only when the immersive view is not mounted", () => {
    expect(shouldExitOnKey(key("Escape"), { immersive: true, mounted: false })).toBe(true);
    expect(shouldExitOnKey(key("Escape"), { immersive: true, mounted: true })).toBe(false);
  });

  it("ignores every key when not immersive", () => {
    expect(shouldExitOnKey(key("F11"), { immersive: false, mounted: false })).toBe(false);
    expect(shouldExitOnKey(key("f", { ctrlKey: true, shiftKey: true }), { immersive: false, mounted: false })).toBe(false);
  });

  it("exits on Ctrl+Shift+F while immersive but not on Ctrl+F alone", () => {
    expect(shouldExitOnKey(key("f", { ctrlKey: true, shiftKey: true }), { immersive: true, mounted: true })).toBe(true);
    expect(shouldExitOnKey(key("f", { ctrlKey: true }), { immersive: true, mounted: true })).toBe(false);
  });
});

describe("exitImmersive", () => {
  it("leaves plain fullscreen without moving or resizing the window", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => setTimeout(callback, 0) });
    await setImmersiveFullscreen(true);
    await exitImmersive();
    expect(appWindow.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(appWindow.setPosition).not.toHaveBeenCalled();
    expect(appWindow.setSize).not.toHaveBeenCalled();
  });
});

describe("setImmersiveFullscreen", () => {
  it("ignores a second request while the window is still entering fullscreen", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => setTimeout(callback, 0) });
    appWindow.setFullscreen.mockClear();
    appWindow.isMaximized.mockClear();
    await Promise.all([setImmersiveFullscreen(true), setImmersiveFullscreen(true)]);
    expect(appWindow.isMaximized).toHaveBeenCalledTimes(1);
    expect(appWindow.setFullscreen).toHaveBeenCalledTimes(1);
    await exitImmersive();
  });
});
