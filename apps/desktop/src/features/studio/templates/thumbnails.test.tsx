import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createPage } from "../model/design";
import { useTemplateThumbnail } from "./thumbnails";

const rpc = vi.hoisted(() => ({ studioThumbnail: vi.fn() }));

vi.mock("@/shared/rpc/operations", () => ({ studioThumbnail: rpc.studioThumbnail }));
vi.mock("../design/measure", () => ({ measureTexts: vi.fn().mockResolvedValue({}) }));

const page = () => createPage(200, 300);
const pending: ((value: { image: string }) => void)[] = [];

function settleNext() {
  act(() => pending.shift()?.({ image: btoa("jpeg") }));
}

describe("template thumbnail queue", () => {
  beforeAll(() => {
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:thumbnail"), configurable: true });
    rpc.studioThumbnail.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  });

  it("draws a card that is on screen and keeps the picture once it is ready", async () => {
    const { result } = renderHook(() => useTemplateThumbnail("happy", page, "en", 140));
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(pending).toHaveLength(1));
    settleNext();

    await waitFor(() => expect(result.current).toEqual({ status: "ready", url: "blob:thumbnail" }));
  });

  it("skips a card that scrolled away before its turn so the cards on screen are drawn first", async () => {
    const first = renderHook(() => useTemplateThumbnail("busyA", page, "en", 140));
    const second = renderHook(() => useTemplateThumbnail("busyB", page, "en", 140));
    const gone = renderHook(({ shown }) => useTemplateThumbnail("gone", shown ? page : null, "en", 140), { initialProps: { shown: true } });
    const onScreen = renderHook(() => useTemplateThumbnail("onScreen", page, "en", 140));
    await waitFor(() => expect(pending).toHaveLength(2));
    const calls = rpc.studioThumbnail.mock.calls.length;

    gone.rerender({ shown: false });
    settleNext();
    settleNext();
    await waitFor(() => expect(pending).toHaveLength(1));
    settleNext();

    await waitFor(() => expect(onScreen.result.current.status).toBe("ready"));
    expect(rpc.studioThumbnail.mock.calls.length).toBe(calls + 1);
    expect(gone.result.current.status).toBe("loading");
    expect(first.result.current.status).toBe("ready");
    expect(second.result.current.status).toBe("ready");
  });

  it("reports a failed drawing so the card can fall back to the live page", async () => {
    rpc.studioThumbnail.mockImplementationOnce(() => Promise.reject(new Error("engine down")));

    const { result } = renderHook(() => useTemplateThumbnail("broken", page, "en", 140));

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("frees pictures that no card shows once too many are kept", async () => {
    const revoke = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true });
    rpc.studioThumbnail.mockImplementation(() => Promise.resolve({ image: btoa("jpeg") }));
    const cards = Array.from({ length: 120 }, (_, index) => renderHook(() => useTemplateThumbnail(`many${index}`, page, "en", 140)));
    await waitFor(() => expect(cards.every((card) => card.result.current.status === "ready")).toBe(true));
    expect(revoke).not.toHaveBeenCalled();

    for (const card of cards) card.unmount();

    expect(revoke.mock.calls.length).toBeGreaterThanOrEqual(24);
    const again = renderHook(() => useTemplateThumbnail("many0", page, "en", 140));
    await waitFor(() => expect(again.result.current.status).toBe("ready"));
  });
});
