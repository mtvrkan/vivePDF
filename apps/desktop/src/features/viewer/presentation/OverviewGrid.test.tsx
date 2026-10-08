import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewGrid } from "./OverviewGrid";

const abort = vi.fn();
let finishes = true;
const renderThumb = vi.fn(() => ({
  wait: (resolve: (blob: Blob) => void) => {
    if (finishes) queueMicrotask(() => resolve(new Blob(["x"])));
  },
  abort,
}));
let observers: Array<{ callback: IntersectionObserverCallback; target: Element | null }> = [];

vi.mock("@embedpdf/plugin-scroll/react", () => ({
  useScroll: () => ({ state: { totalPages: 3, currentPage: 1 }, provides: null }),
}));
const capability = { provides: { forDocument: () => ({ renderThumb }) } };

vi.mock("@embedpdf/plugin-thumbnail/react", () => ({
  useThumbnailCapability: () => capability,
}));

beforeEach(() => {
  renderThumb.mockClear();
  abort.mockClear();
  finishes = true;
  observers = [];
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      entry: { callback: IntersectionObserverCallback; target: Element | null };
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, target: null };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OverviewGrid", () => {
  it("does not render any thumbnail before its cell becomes visible", () => {
    render(<OverviewGrid documentId="d" onClose={() => {}} />);

    expect(renderThumb).not.toHaveBeenCalled();
  });

  it("renders only the cells that intersected", async () => {
    render(<OverviewGrid documentId="d" onClose={() => {}} />);

    observers[1].callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await vi.waitFor(() => expect(renderThumb).toHaveBeenCalledTimes(1));

    expect(renderThumb).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it("revokes the object url on unmount", async () => {
    const view = render(<OverviewGrid documentId="d" onClose={() => {}} />);
    observers[0].callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

    view.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("aborts a thumbnail that scrolls out of view before it finishes", async () => {
    finishes = false;
    render(<OverviewGrid documentId="d" onClose={() => {}} />);
    const intersect = (isIntersecting: boolean) => act(() => observers[2].callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));

    intersect(true);
    await vi.waitFor(() => expect(renderThumb).toHaveBeenCalledTimes(1));
    intersect(false);

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("keeps a finished thumbnail when its cell leaves the view", async () => {
    render(<OverviewGrid documentId="d" onClose={() => {}} />);
    const intersect = (isIntersecting: boolean) => act(() => observers[0].callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
    intersect(true);
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

    intersect(false);
    intersect(true);

    expect(renderThumb).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
