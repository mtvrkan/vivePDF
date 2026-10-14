import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Task = { wait: (done: (blob: Blob) => void, fail: () => void) => void; abort: () => void };

const engine = vi.hoisted(() => ({ renderPageRect: vi.fn() }));
const registry = vi.hoisted(() => ({
  value: {
    registry: { getEngine: () => engine },
    documents: { doc: { document: { pages: [{ size: { width: 600, height: 800 } }, { size: { width: 800, height: 450 } }] } } },
  } as { registry: unknown; documents: Record<string, unknown> },
}));

vi.mock("@embedpdf/core/react", () => ({ useRegistry: () => registry.value }));
vi.mock("@/features/viewer/overlay/pageSize", () => ({ pageTurns: () => 0 }));

const { NextPagePreview } = await import("./NextPagePreview");

function taskThat(outcome: "render" | "fail" | "hang"): Task {
  return {
    wait: (done, fail) => {
      if (outcome === "render") done(new Blob(["png"]));
      if (outcome === "fail") fail();
    },
    abort: () => undefined,
  };
}

beforeEach(() => {
  engine.renderPageRect.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:next");
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

describe("NextPagePreview", () => {
  it("renders the whole next page sharp enough to fill the preview box", async () => {
    engine.renderPageRect.mockReturnValue(taskThat("render"));
    const onSelect = vi.fn();

    await act(async () => {
      render(<NextPagePreview documentId="doc" pageIndex={1} label="Next: page 2" onSelect={onSelect} />);
    });

    const [, , rect, options] = engine.renderPageRect.mock.calls.at(-1) as [unknown, unknown, unknown, { scaleFactor: number }];
    expect(rect).toEqual({ origin: { x: 0, y: 0 }, size: { width: 800, height: 450 } });
    expect(options.scaleFactor).toBeCloseTo(448 / 800);
    expect(screen.getByTestId("presenter-next-page").querySelector("img")?.getAttribute("src")).toBe("blob:next");
    fireEvent.click(screen.getByRole("button", { name: "Next: page 2" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows a placeholder while the page is still rendering", () => {
    engine.renderPageRect.mockReturnValue(taskThat("hang"));

    render(<NextPagePreview documentId="doc" pageIndex={0} label="Next: page 1" onSelect={() => undefined} />);

    const button = screen.getByTestId("presenter-next-page");
    expect(button.querySelector("img")).toBeNull();
    expect(button.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("keeps the page number and stops pulsing when the page cannot be drawn", async () => {
    engine.renderPageRect.mockReturnValue(taskThat("fail"));

    await act(async () => {
      render(<NextPagePreview documentId="doc" pageIndex={0} label="Next: page 1" onSelect={() => undefined} />);
    });

    const button = screen.getByTestId("presenter-next-page");
    expect(button.querySelector(".animate-pulse")).toBeNull();
    expect(button.textContent).toContain("1");
  });
});
