import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { toolGroups, toolsInGroup } from "@/app/navigation";
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

  describe("tools menu", () => {
    function openTools(route = "/") {
      render(
        <MemoryRouter initialEntries={[route]}>
          <TopBar />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Tools" }));
      return {
        categories: within(screen.getByTestId("tools-menu-categories")).getAllByRole("menuitem"),
        tools: () => within(screen.getByTestId("tools-menu-tools")).getAllByRole("menuitem"),
      };
    }

    it("lists every category with its tool count and opens on the current tool's category", () => {
      const { categories, tools } = openTools("/tools/security?tab=watermark");

      expect(categories.map((category) => category.dataset.toolCategory)).toEqual(toolGroups);
      expect(categories.find((category) => category.dataset.toolCategory === "check")?.textContent).toContain(String(toolsInGroup("check").length));
      expect(categories.find((category) => category.getAttribute("aria-current"))?.dataset.toolCategory).toBe("marks");
      expect(tools().map((tool) => tool.dataset.toolId)).toEqual(toolsInGroup("marks").map((tool) => tool.id));
    });

    it("shows a category's tools after a short hover, but not when the pointer only passes over it", () => {
      vi.useFakeTimers();
      const { categories, tools } = openTools();
      const security = categories.find((category) => category.dataset.toolCategory === "security") as HTMLElement;
      const forms = categories.find((category) => category.dataset.toolCategory === "forms") as HTMLElement;

      fireEvent.pointerEnter(forms);
      fireEvent.pointerLeave(forms);
      act(() => vi.advanceTimersByTime(200));
      const afterPass = tools().map((tool) => tool.dataset.toolId);
      fireEvent.pointerEnter(security);
      act(() => vi.advanceTimersByTime(200));

      expect(afterPass).toEqual(toolsInGroup("organize").map((tool) => tool.id));
      expect(tools().map((tool) => tool.dataset.toolId)).toEqual(toolsInGroup("security").map((tool) => tool.id));
      vi.useRealTimers();
    });

    it("switches at once on click and closes when a tool is chosen", () => {
      const { categories, tools } = openTools();

      fireEvent.click(categories.find((category) => category.dataset.toolCategory === "automate") as HTMLElement);
      const shown = tools();
      fireEvent.click(shown[0]);

      expect(shown.map((tool) => tool.dataset.toolId)).toEqual(toolsInGroup("automate").map((tool) => tool.id));
      expect(screen.queryByTestId("tools-menu-tools")).toBeNull();
    });
  });
});
