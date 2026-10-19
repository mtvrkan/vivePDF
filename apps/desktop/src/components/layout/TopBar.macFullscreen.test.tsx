import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";

type Change = { fullscreen: boolean; lights: { x: number; y: number; size: number }[] };

const shell = vi.hoisted(() => ({
  state: { fullscreen: false, lights: [] } as Change,
  focused: true,
  emit: null as null | ((change: Change) => void),
}));
const appWindow = vi.hoisted(() => ({
  isFullscreen: () => Promise.resolve(shell.state.fullscreen),
  isMaximized: () => Promise.resolve(false),
  isFocused: () => Promise.resolve(shell.focused),
  onResized: () => Promise.resolve(() => undefined),
  onFocusChanged: () => Promise.resolve(() => undefined),
  listen: (_name: string, handler: (event: { payload: Change }) => void) => {
    shell.emit = (change) => handler({ payload: change });
    return Promise.resolve(() => undefined);
  },
  setTitle: () => Promise.resolve(),
  close: vi.fn(() => Promise.resolve()),
  setFullscreen: vi.fn<(fullscreen: boolean) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/shared/lib/platform", async (importOriginal) => ({ ...(await importOriginal<object>()), isMac: true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => appWindow }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => Promise.resolve(command === "mac_fullscreen_state" ? shell.state : undefined)),
}));

const { TopBar } = await import("./TopBar");

const LIGHTS = [
  { x: 15, y: 17, size: 14 },
  { x: 38, y: 17, size: 14 },
  { x: 61, y: 17, size: 14 },
];

class StillResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

async function renderBar() {
  render(
    <MemoryRouter>
      <TopBar />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

describe("TopBar in macOS full screen", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    shell.state = { fullscreen: false, lights: [] };
    shell.focused = true;
    appWindow.close.mockClear();
    appWindow.setFullscreen.mockClear();
    vi.stubGlobal("ResizeObserver", StillResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("draws the traffic lights where the window had them once it goes full screen", async () => {
    await renderBar();
    expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();

    act(() => shell.emit?.({ fullscreen: true, lights: LIGHTS }));

    const exit = screen.getByRole("button", { name: "Exit full screen" });
    expect(exit.style.left).toBe("46px");
    expect(screen.getByRole("button", { name: "Minimize" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("banner").className).toContain("pl-traffic-lights");

    fireEvent.click(exit);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(appWindow.setFullscreen).toHaveBeenCalledWith(false);
    expect(appWindow.close).toHaveBeenCalledTimes(1);

    act(() => shell.emit?.({ fullscreen: false, lights: [] }));
    expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
  });

  it("finds the lights again when the bar comes back while the window is still full screen", async () => {
    shell.state = { fullscreen: true, lights: LIGHTS };

    await renderBar();

    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("greys the lights while another window has focus", async () => {
    shell.state = { fullscreen: true, lights: LIGHTS };
    shell.focused = false;

    await renderBar();

    expect(screen.getByRole("button", { name: "Close" }).className).toContain("bg-traffic-idle");
  });
});
