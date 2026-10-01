import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNavHistoryStore } from "@/shared/store/navHistoryStore";

const scrollToPage = vi.fn();

vi.mock("@embedpdf/plugin-annotation/react", () => ({ useAnnotation: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-scroll/react", () => ({
  useScroll: () => ({ provides: { scrollToPage, getCurrentPage: () => 1, getTotalPages: () => 800 } }),
}));

const { usePageNavigation } = await import("./usePageNavigation");

afterEach(() => {
  scrollToPage.mockClear();
  useNavHistoryStore.setState({ stacks: {} });
});

describe("usePageNavigation", () => {
  it("jumps straight to a far page instead of scrolling through every page on the way", () => {
    const { result } = renderHook(() => usePageNavigation("doc"));

    result.current.jumpTo(800);

    expect(scrollToPage).toHaveBeenCalledWith({ pageNumber: 800, behavior: "instant" });
  });

  it("keeps a typed page inside the document", () => {
    const { result } = renderHook(() => usePageNavigation("doc"));

    result.current.jumpTo(5000);

    expect(scrollToPage).toHaveBeenCalledWith({ pageNumber: 800, behavior: "instant" });
  });

  it("remembers where the jump started so Back returns there", () => {
    const { result } = renderHook(() => usePageNavigation("doc"));

    result.current.jumpTo(400);

    expect(useNavHistoryStore.getState().back("doc", 400)).toBe(1);
  });
});
