import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";

const bridge = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./drawingInsert", () => ({ openPresentationDrawing: bridge.open }));

const { PresentationInsertMenu } = await import("./PresentationInsertMenu");

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  bridge.open.mockReset();
  usePresentationStore.getState().resetSession();
  useViewerOverlayStore.getState().setMode(null);
});

afterEach(cleanup);

describe("PresentationInsertMenu", () => {
  it("lists every kind of drawing and opens the picked one's editor", () => {
    const onOpenChange = vi.fn();
    render(<PresentationInsertMenu onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(10);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Add formula" }));

    expect(bridge.open).toHaveBeenCalledWith("formula");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("is available on a black or white board and unavailable while the page editor is open", () => {
    render(<PresentationInsertMenu />);
    const button = screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement;

    act(() => usePresentationStore.getState().setBlackout("black"));
    expect(button.disabled).toBe(false);

    act(() => {
      usePresentationStore.getState().setBlackout("none");
      useViewerOverlayStore.getState().setMode("text");
    });
    expect(button.disabled).toBe(true);
  });
});
