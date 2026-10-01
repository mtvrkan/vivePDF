import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toastLifetime, useToastStore } from "@/shared/store/toastStore";
import { axeViolations } from "@/test/axe";
import { Toaster } from "./Toaster";

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [], held: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("keeps its live region mounted while empty so the first toast is announced", () => {
    const { container } = render(<Toaster />);
    const region = container.querySelector("[aria-live='polite']");
    expect(region).not.toBeNull();
    expect(region?.children.length).toBe(0);
  });

  it("renders error toasts as alerts with a named, 24px close button and no axe violations", async () => {
    const { container } = render(<Toaster />);
    act(() => {
      useToastStore.getState().push("error", "Could not save");
      useToastStore.getState().push("info", "Saved a copy", { label: "Undo", onClick: () => undefined });
    });
    expect(screen.getByRole("alert").textContent).toContain("Could not save");
    const closeButtons = screen.getAllByRole("button", { name: "common.close" });
    expect(closeButtons).toHaveLength(2);
    expect(closeButtons[0].className).toContain("size-6");
    vi.useRealTimers();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("gives errors and actionable toasts longer to read than plain notices", () => {
    expect(toastLifetime("info")).toBeLessThan(toastLifetime("error"));
    expect(toastLifetime("success", { label: "Undo", onClick: () => undefined })).toBe(toastLifetime("error"));
  });

  it("does not expire a toast while the pointer rests on the stack", () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().push("info", "Hold me");
    });
    fireEvent.mouseEnter(screen.getByRole("status").parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(toastLifetime("info") + 3000);
    });
    expect(screen.queryByText("Hold me")).not.toBeNull();
    fireEvent.mouseLeave(screen.getByRole("status").parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText("Hold me")).toBeNull();
  });
});
