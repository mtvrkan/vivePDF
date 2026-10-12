import { act, cleanup, render, screen } from "@testing-library/react";
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

  it.each(["black", "white"] as const)("stays visible above the %s board", (board) => {
    vi.useFakeTimers();
    act(() => usePresentationStore.getState().setBlackout(board));
    renderBar();
    act(() => vi.advanceTimersByTime(3000));
    expect(bar().className).toContain("z-50");
    expect(bar().className).toContain("opacity-100");
  });
});
