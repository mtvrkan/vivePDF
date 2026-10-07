import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewGrid } from "./OverviewGrid";

const renderThumb = vi.fn(() => ({ toPromise: () => Promise.resolve(new Blob(["x"])) }));
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
});
