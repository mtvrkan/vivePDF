import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/shared/rpc/thumbnail", async (original) => ({ ...(await original<typeof import("@/shared/rpc/thumbnail")>()), renderThumbnail: rpc.render }));
vi.mock("@/features/pages/sharedVisibility", () => ({
  observeVisibility: (_element: Element, listener: (visible: boolean) => void) => {
    listener(true);
    return () => undefined;
  },
}));

const { LazyThumbnail } = await import("./PageGrid");
const { STAMP_CHECK_MS } = await import("./thumbnailStamps");

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const picture = () => document.querySelector("img")?.getAttribute("src");
const answer = (image: string, stamp: string) => ({ image, width: 10, height: 10, pageCount: 1, format: "jpeg", stamp });

afterEach(() => {
  cleanup();
  rpc.render.mockReset();
  vi.useRealTimers();
});

describe("LazyThumbnail", () => {
  it("renders the page once and answers a quick second look from the cache", async () => {
    rpc.render.mockResolvedValue(answer("AAA", "1-1"));
    render(<LazyThumbnail path="/quick.pdf" page={1} />);
    await flush();
    cleanup();

    render(<LazyThumbnail path="/quick.pdf" page={1} />);
    await flush();

    expect(picture()).toBe("data:image/jpeg;base64,AAA");
    expect(rpc.render).toHaveBeenCalledTimes(1);
  });

  it("shows the new page after the file was rewritten at the same path", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    rpc.render.mockResolvedValueOnce(answer("OLD", "1-1"));
    render(<LazyThumbnail path="/edited.pdf" page={1} />);
    await flush();
    cleanup();
    vi.setSystemTime(Date.now() + STAMP_CHECK_MS);
    rpc.render.mockResolvedValue(answer("NEW", "2-2"));

    render(<LazyThumbnail path="/edited.pdf" page={1} />);
    const first = picture();
    await flush();
    await flush();

    expect(first).toBe("data:image/jpeg;base64,OLD");
    expect(picture()).toBe("data:image/jpeg;base64,NEW");
  });

  it("keeps the cached page when a later check finds the file unchanged", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    rpc.render.mockResolvedValue(answer("SAME", "1-1"));
    render(<LazyThumbnail path="/steady.pdf" page={1} />);
    await flush();
    cleanup();
    vi.setSystemTime(Date.now() + STAMP_CHECK_MS);

    render(<LazyThumbnail path="/steady.pdf" page={1} />);
    await flush();
    await flush();

    expect(picture()).toBe("data:image/jpeg;base64,SAME");
    expect(rpc.render).toHaveBeenCalledTimes(2);
  });
});
