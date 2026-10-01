import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";
import { PageBitmap } from "./PageBitmap";
import { darkPageStyle } from "./pageTones";

const getPageTones = vi.hoisted(() => vi.fn());
vi.mock("@/shared/rpc/operations", () => ({ getPageTones }));

const DARK = "invert(0.92) hue-rotate(180deg)";
let documentId = "";
let counter = 0;

function bitmap(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-page-bitmap]") as HTMLElement;
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  getPageTones.mockReset();
  counter += 1;
  documentId = `doc-tones-${counter}`;
  useDocumentStore.getState().register(documentId, `C:/belgeler/kapak-${counter}.pdf`, null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useDocumentStore.getState().remove(documentId);
});

describe("PageBitmap", () => {
  it("keeps the pictures of a light page in their own colours while the rest is inverted", async () => {
    getPageTones.mockResolvedValue({ pages: [{ page: 1, dark: false, pictures: [{ x: 0.25, y: 0.25, width: 0.5, height: 0.25 }] }] });

    const { container } = render(
      <PageBitmap documentId={documentId} pageIndex={0} scheme="dark">
        <img alt="" />
      </PageBitmap>,
    );
    expect(bitmap(container).style.filter).toBe(DARK);
    await settle();

    const filterId = bitmap(container).style.filter.match(/url\("?#([\w-]+)"?\)/)?.[1];
    expect(filterId).toBeTruthy();
    const filter = container.querySelector(`filter#${filterId}`) as SVGFilterElement;
    const flood = filter.querySelector("feFlood") as SVGElement;
    expect([flood.getAttribute("x"), flood.getAttribute("y"), flood.getAttribute("width"), flood.getAttribute("height")]).toEqual(["0.25", "0.25", "0.5", "0.25"]);
    expect(bitmap(container).dataset.pageTone).toBe("pictures");
    expect(getPageTones).toHaveBeenCalledWith({ path: `C:/belgeler/kapak-${counter}.pdf`, password: undefined, pages: "1" });
  });

  it("leaves a page that is already dark as it is", async () => {
    getPageTones.mockResolvedValue({ pages: [{ page: 3, dark: true, pictures: [] }] });

    const { container } = render(
      <PageBitmap documentId={documentId} pageIndex={2} scheme="dark">
        <img alt="" />
      </PageBitmap>,
    );
    await settle();

    expect(bitmap(container).style.filter).toBe("");
    expect(bitmap(container).dataset.pageTone).toBe("dark");
    expect(container.querySelector("filter")).toBeNull();
  });

  it("falls back to inverting the whole page when the tones cannot be read", async () => {
    getPageTones.mockRejectedValue(new Error("engine gone"));

    const { container } = render(
      <PageBitmap documentId={documentId} pageIndex={0} scheme="dark">
        <img alt="" />
      </PageBitmap>,
    );
    await settle();

    expect(bitmap(container).style.filter).toBe(DARK);
  });

  it("asks nothing and adds no layer for original colours, and recolours pictures too in the other schemes", async () => {
    const plain = render(
      <PageBitmap documentId={documentId} pageIndex={0} scheme="normal">
        <img alt="" data-testid="page" />
      </PageBitmap>,
    );
    expect(bitmap(plain.container)).toBeNull();
    plain.unmount();

    const sepia = render(
      <PageBitmap documentId={documentId} pageIndex={0} scheme="sepia">
        <img alt="" />
      </PageBitmap>,
    );
    await settle();

    expect(bitmap(sepia.container).style.filter).toContain("vivepdf-page-colors-sepia");
    expect(getPageTones).not.toHaveBeenCalled();
  });
});

describe("darkPageStyle", () => {
  it("inverts while the tone is unknown or the page has no pictures", () => {
    expect(darkPageStyle(null, "f")).toEqual({ filter: DARK });
    expect(darkPageStyle({ page: 1, dark: false, pictures: [] }, "f")).toEqual({ filter: DARK });
  });
});
