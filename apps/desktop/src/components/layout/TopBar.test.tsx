import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { TopBar } from "./TopBar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => undefined),
    setTitle: () => Promise.resolve(),
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = [];
let overflowing = false;

class FakeResizeObserver {
  private readonly entry: { callback: ResizeObserverCallback; targets: Element[] };

  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: [] };
    observers.push(this.entry);
  }

  observe(target: Element) {
    this.entry.targets.push(target);
  }

  unobserve() {}

  disconnect() {
    this.entry.targets = [];
  }
}

function search() {
  return screen.getAllByRole("button").find((button) => button.textContent?.includes("Ctrl K") || button.getAttribute("aria-label") === "Search tools, pages or documents");
}

describe("TopBar", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => (overflowing ? 1400 : 1000) });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
  });

  beforeEach(() => {
    overflowing = false;
    observers.length = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the full labels while everything fits", () => {
    render(
      <MemoryRouter>
        <TopBar />
      </MemoryRouter>,
    );

    expect(search()?.textContent).toContain("Ctrl K");
  });

  it("shrinks when its own items grow later, as when a font or the interface scale lands after the first layout", () => {
    render(
      <MemoryRouter>
        <TopBar />
      </MemoryRouter>,
    );
    const header = document.querySelector("header") as HTMLElement;

    overflowing = true;
    act(() => {
      for (const observer of observers) if (observer.targets.some((target) => target.parentElement === header)) observer.callback([], observer as unknown as ResizeObserver);
    });

    expect(search()?.textContent).not.toContain("Ctrl K");
  });

  it("stops shrinking at the most compact layout instead of looping", () => {
    overflowing = true;

    render(
      <MemoryRouter>
        <TopBar />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });
});
