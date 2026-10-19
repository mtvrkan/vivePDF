import { describe, expect, it, vi } from "vitest";
import { exitImmersive, followWindowFullscreen, markWindowMoved, onImmersiveExit, setImmersiveFullscreen, shouldExitOnKey } from "./immersive";

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
  isFullscreen: vi.fn(async () => true),
  setResizable: vi.fn<(resizable: boolean) => Promise<void>>(async () => {}),
  innerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
  center: vi.fn(async () => {}),
}));

type Monitor = { position: { x: number; y: number }; size: { width: number; height: number } };
const screen = vi.hoisted(() => ({ monitor: null as null | Monitor, all: [] as Monitor[] }));

const ui = vi.hoisted(() => ({ immersive: false }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => appWindow,
  currentMonitor: async () => screen.monitor,
  availableMonitors: async () => screen.all,
  PhysicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  PhysicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

vi.mock("@/shared/store/uiStore", () => ({
  useUiStore: {
    getState: () => ({
      immersive: ui.immersive,
      setImmersive: (next: boolean) => {
        ui.immersive = next;
      },
      setImmersiveMounted: () => {},
    }),
  },
}));

vi.mock("@/shared/store/presentationStore", () => ({
  usePresentationStore: { getState: () => ({ resetSession: () => {} }) },
}));

const key = (value: string, extra: Partial<{ ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
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

  it("takes Command and Control+Command+F on macOS only", () => {
    const context = { immersive: true, mounted: true };
    expect(shouldExitOnKey(key("f", { metaKey: true, shiftKey: true }), context, true)).toBe(true);
    expect(shouldExitOnKey(key("f", { metaKey: true, ctrlKey: true }), context, true)).toBe(true);
    expect(shouldExitOnKey(key("f", { metaKey: true, shiftKey: true }), context, false)).toBe(false);
    expect(shouldExitOnKey(key("f", { metaKey: true, ctrlKey: true }), context, false)).toBe(false);
    expect(shouldExitOnKey(key("f", { metaKey: true }), context, true)).toBe(false);
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

describe("markWindowMoved", () => {
  it("brings a window that swapped screens back to where the presentation started", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => setTimeout(callback, 0) });
    appWindow.isFullscreen.mockResolvedValue(false);
    appWindow.setPosition.mockClear();
    appWindow.setSize.mockClear();
    await setImmersiveFullscreen(true);
    markWindowMoved();

    await exitImmersive();

    expect(appWindow.setPosition).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(appWindow.setSize).toHaveBeenCalledWith({ width: 800, height: 600 });
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

describe("onImmersiveExit", () => {
  it("tells listeners when the presentation ends until they unsubscribe", async () => {
    const listener = vi.fn();
    const stop = onImmersiveExit(listener);

    await exitImmersive();
    stop();
    await exitImmersive();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("followWindowFullscreen", () => {
  it("ends the presentation when the system takes the window out of full screen, as the macOS green button does", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => setTimeout(callback, 0) });
    await setImmersiveFullscreen(true);
    appWindow.isFullscreen.mockResolvedValue(true);
    await followWindowFullscreen();
    const stillOn = ui.immersive;

    appWindow.isFullscreen.mockResolvedValue(false);
    await followWindowFullscreen();

    expect(stillOn).toBe(true);
    expect(ui.immersive).toBe(false);
  });

  it("waits until the window has reached full screen before reading a windowed size as an exit", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => setTimeout(callback, 0) });
    await setImmersiveFullscreen(true);
    appWindow.isFullscreen.mockResolvedValue(false);

    await followWindowFullscreen();

    expect(ui.immersive).toBe(true);
    await exitImmersive();
  });

  it("still opens the presentation in the window when full screen is refused", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => setTimeout(callback, 0) });
    appWindow.setFullscreen.mockRejectedValueOnce(new Error("denied"));

    await setImmersiveFullscreen(true);

    expect(ui.immersive).toBe(true);
    await exitImmersive();
  });
});

describe("forced cover on Windows", () => {
  it("pins the window over the whole screen, corrects the frame offset and gives resizing back at the end", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => setTimeout(callback, 0) });
    screen.monitor = { position: { x: 1920, y: 0 }, size: { width: 2560, height: 1440 } };
    appWindow.innerSize.mockResolvedValueOnce({ width: 800, height: 600 }).mockResolvedValueOnce({ width: 1200, height: 900 });
    appWindow.innerPosition.mockResolvedValueOnce({ x: 1927, y: 0 });
    appWindow.setPosition.mockClear();
    appWindow.setResizable.mockClear();

    await setImmersiveFullscreen(true);
    const resizableDuringShow = appWindow.setResizable.mock.calls.map(([value]) => value);
    await exitImmersive();
    screen.monitor = null;

    expect(appWindow.setPosition).toHaveBeenCalledWith({ x: 1913, y: 0 });
    expect(resizableDuringShow).toEqual([false]);
    expect(appWindow.setResizable).toHaveBeenLastCalledWith(true);
  });
});

describe("restoring after the screen is gone", () => {
  it("centres the window instead of sending it back to a projector that was unplugged", async () => {
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => setTimeout(callback, 0) });
    appWindow.isFullscreen.mockResolvedValue(false);
    appWindow.outerPosition.mockResolvedValueOnce({ x: 3000, y: 100 });
    screen.all = [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }];
    appWindow.setPosition.mockClear();
    appWindow.center.mockClear();
    await setImmersiveFullscreen(true);
    markWindowMoved();

    await exitImmersive();
    screen.all = [];

    expect(appWindow.setPosition).not.toHaveBeenCalled();
    expect(appWindow.center).toHaveBeenCalledTimes(1);
  });
});
