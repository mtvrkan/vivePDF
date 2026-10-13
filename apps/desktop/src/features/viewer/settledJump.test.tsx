import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_MS, jumpUntilSettled, SETTLE_MS } from "./settledJump";

function fakeScroll(start = 1) {
  const state = { currentPage: start };
  const scrollToPage = vi.fn(({ pageNumber }: { pageNumber: number }) => {
    state.currentPage = pageNumber;
  });
  return { state, scroll: { scrollToPage, getMetrics: () => ({ currentPage: state.currentPage, visiblePages: [state.currentPage] }) } };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("jumpUntilSettled", () => {
  it("jumps again when the first layout pushes the view back to the first page", () => {
    const { state, scroll } = fakeScroll();
    jumpUntilSettled(scroll, 4);

    state.currentPage = 1;
    vi.advanceTimersByTime(CHECK_MS);

    expect(scroll.scrollToPage).toHaveBeenCalledTimes(2);
    expect(state.currentPage).toBe(4);
  });

  it("leaves the view alone once the reader scrolls or clicks", () => {
    const { state, scroll } = fakeScroll();
    jumpUntilSettled(scroll, 4);

    window.dispatchEvent(new Event("wheel"));
    state.currentPage = 2;
    vi.advanceTimersByTime(SETTLE_MS);

    expect(scroll.scrollToPage).toHaveBeenCalledTimes(1);
    expect(state.currentPage).toBe(2);
  });

  it("stops watching after the settle time and when stopped by hand", () => {
    const first = fakeScroll();
    jumpUntilSettled(first.scroll, 4);
    vi.advanceTimersByTime(SETTLE_MS);
    first.state.currentPage = 1;
    vi.advanceTimersByTime(SETTLE_MS);
    expect(first.scroll.scrollToPage).toHaveBeenCalledTimes(1);

    const second = fakeScroll();
    jumpUntilSettled(second.scroll, 6)();
    second.state.currentPage = 1;
    vi.advanceTimersByTime(SETTLE_MS);
    expect(second.scroll.scrollToPage).toHaveBeenCalledTimes(1);
  });
});
