import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";
import { PageTextLayer } from "./PageTextLayer";

const getPageText = vi.hoisted(() => vi.fn());
vi.mock("@/shared/rpc/operations", () => ({ getPageText }));

type Observed = { callback: IntersectionObserverCallback; disconnected: boolean };
const observers: Observed[] = [];

class FakeIntersectionObserver {
  private readonly entry: Observed;
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}

function showAll() {
  observers.filter((entry) => !entry.disconnected).forEach((entry) => entry.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
}

beforeEach(() => {
  vi.useFakeTimers();
  observers.length = 0;
  getPageText.mockReset();
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  useDocumentStore.getState().register("doc-a11y", "C:/belgeler/erişilebilir.pdf", null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useDocumentStore.getState().remove("doc-a11y");
});

describe("PageTextLayer", () => {
  it("asks for nothing until the page is on screen, then reads visible pages in one call", async () => {
    getPageText.mockResolvedValue({ pages: [{ page: 2, text: "İkinci sayfa metni." }, { page: 3, text: "" }], pageCount: 5 });
    const { container } = render(
      <>
        <PageTextLayer documentId="doc-a11y" pageIndex={1} />
        <PageTextLayer documentId="doc-a11y" pageIndex={2} />
      </>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getPageText).not.toHaveBeenCalled();
    await act(async () => {
      showAll();
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getPageText).toHaveBeenCalledTimes(1);
    expect(getPageText).toHaveBeenCalledWith({ path: "C:/belgeler/erişilebilir.pdf", password: undefined, pages: "2,3" });
    const layers = container.querySelectorAll("[data-page-text]");
    expect(layers[0]?.querySelector(".sr-only")?.textContent).toBe("viewer.pageText.headingİkinci sayfa metni.");
    expect(layers[0]?.querySelector("h2")).not.toBeNull();
    expect(layers[1]?.textContent).toContain("viewer.pageText.empty");
    expect(layers[0]?.getAttribute("aria-hidden")).toBeNull();
  });

  it("stays hidden from assistive technology while the text is not loaded", async () => {
    getPageText.mockRejectedValue(new Error("password"));
    const { container } = render(<PageTextLayer documentId="doc-a11y" pageIndex={0} />);
    await act(async () => {
      showAll();
      await vi.advanceTimersByTimeAsync(500);
    });
    const layer = container.querySelector("[data-page-text]");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(layer?.textContent).toBe("");
  });
});
