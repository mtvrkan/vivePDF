import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore } from "@/shared/store/presentationStore";

vi.mock("@embedpdf/plugin-scroll/react", () => ({
  useScroll: () => ({ state: { currentPage: 1, totalPages: 3 }, provides: null }),
}));
vi.mock("@embedpdf/plugin-zoom/react", () => ({
  useZoom: () => ({ state: { currentZoomLevel: 1, isMarqueeZoomActive: false }, provides: null }),
}));
vi.mock("./presentation/useCodeBlocks", () => ({ useCodeBlocksForPage: () => null }));

const { PresenterBar } = await import("./ImmersiveBar");

function bar() {
  return screen.getByRole("button", { name: "Blackout (black)" }).closest(".fixed") as HTMLElement;
}

function renderBar() {
  render(<PresenterBar documentId="doc" onExit={() => undefined} onManualZoom={() => undefined} sessionAnnotations={[]} onClearSessionAnnotations={() => undefined} />);
}

describe("PresenterBar", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => usePresentationStore.getState().resetSession());

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("hides after a pause over the slides", () => {
    vi.useFakeTimers();
    renderBar();
    expect(bar().className).toContain("z-30");
    act(() => vi.advanceTimersByTime(3000));
    expect(bar().className).toContain("opacity-0");
  });

  it("comes back only when the pointer reaches the bottom edge", () => {
    vi.useFakeTimers();
    renderBar();
    act(() => vi.advanceTimersByTime(3000));

    fireEvent.mouseMove(window, { clientY: window.innerHeight / 2 });
    const afterMiddle = bar().className;
    fireEvent.mouseMove(window, { clientY: window.innerHeight - 10 });

    expect(afterMiddle).toContain("opacity-0");
    expect(bar().className).toContain("opacity-100");
    act(() => vi.advanceTimersByTime(3000));
    expect(bar().className).toContain("opacity-0");
  });

  it.each(["black", "white"] as const)("stays visible above the %s board", (board) => {
    vi.useFakeTimers();
    act(() => usePresentationStore.getState().setBlackout(board));
    renderBar();
    act(() => vi.advanceTimersByTime(3000));
    expect(bar().className).toContain("z-50");
    expect(bar().className).toContain("opacity-100");
  });

  it("closes the style panel on a click outside it and keeps it open for clicks inside", () => {
    act(() => usePresentationStore.getState().setTool("pen"));
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Drawing style" }));
    const thickness = screen.getByRole("slider", { name: /Thickness/ });
    fireEvent.pointerDown(thickness);
    expect(screen.queryByRole("slider", { name: /Thickness/ })).not.toBeNull();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("slider", { name: /Thickness/ })).toBeNull();
  });

  it("closes the settings panel on a click outside it", () => {
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Presentation settings" }));
    expect(screen.getByRole("checkbox", { name: /cursor/i })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("checkbox", { name: /cursor/i })).toBeNull();
  });

  it.each(["temporary", "annotations"] as const)("offers Insert while drawings are %s", (mode) => {
    usePresentationStore.setState({ drawingsMode: mode });

    renderBar();

    expect(screen.getByRole("button", { name: "Insert" })).toBeTruthy();
    usePresentationStore.setState({ drawingsMode: "temporary" });
  });

  it("switches the speaker notes on and off from the bar", () => {
    renderBar();
    const notes = screen.getByRole("button", { name: "Speaker notes" });

    fireEvent.click(notes);
    expect(usePresentationStore.getState().notesOpen).toBe(true);
    fireEvent.click(notes);
    expect(usePresentationStore.getState().notesOpen).toBe(false);
  });
});
