import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipLayer } from "./Tooltip";

const SHOW_AFTER_MS = 400;

function renderWithTrigger(expanded?: boolean) {
  render(
    <>
      <TooltipLayer />
      <button type="button" title="Edit" aria-expanded={expanded}>
        E
      </button>
    </>,
  );
  return screen.getByRole("button");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TooltipLayer", () => {
  it("shows the title of a hovered element after a short delay", () => {
    const trigger = renderWithTrigger();
    fireEvent.mouseOver(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS));
    expect(screen.getByRole("tooltip").textContent).toBe("Edit");
  });

  it("stays hidden on a trigger whose menu is open", () => {
    const trigger = renderWithTrigger(true);
    fireEvent.mouseOver(trigger);
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides when Escape is pressed", () => {
    const trigger = renderWithTrigger();
    fireEvent.mouseOver(trigger);
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
