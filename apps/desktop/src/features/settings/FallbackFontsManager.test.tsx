import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCallError, type RpcCallOptions } from "@/shared/rpc/client";
import { useFallbackFontsStore } from "@/shared/store/fallbackFontsStore";
import { useToastStore } from "@/shared/store/toastStore";
import { axeViolations } from "@/test/axe";

const calls: { set: string; options?: RpcCallOptions }[] = [];
const rpc = vi.hoisted(() => ({ fallbackFonts: vi.fn(), fallbackFontsRemove: vi.fn(), fallbackFontsDownload: vi.fn() }));

vi.mock("@/shared/rpc/fallbackFonts", () => rpc);

const { FallbackFontsManager } = await import("./FallbackFontsManager");

const LISTING = {
  directory: "C:/data/fallback-fonts",
  sets: [
    { id: "ja", bytes: 4538888, installed: true },
    { id: "ko", bytes: 4579008, installed: false },
  ],
};

beforeEach(() => {
  calls.length = 0;
  rpc.fallbackFonts.mockReset();
  rpc.fallbackFonts.mockResolvedValue(LISTING);
  rpc.fallbackFontsRemove.mockReset();
  rpc.fallbackFontsRemove.mockResolvedValue({ set: "ja", removed: true });
  rpc.fallbackFontsDownload.mockReset();
  rpc.fallbackFontsDownload.mockImplementation(
    (set: string, options?: RpcCallOptions) =>
      new Promise((_resolve, reject) => {
        calls.push({ set, options });
        options?.onProgress?.({ id: "1", progress: 0.25, message: "progress.downloading", detail: { received: 25, total: 100 } });
        options?.signal?.addEventListener("abort", () => reject(new RpcCallError({ code: "CANCELLED", message: "operation cancelled" })));
      }),
  );
  useFallbackFontsStore.setState({ missing: {}, dismissed: {}, downloads: {} });
  useToastStore.setState({ toasts: [], held: false });
});

afterEach(cleanup);

describe("FallbackFontsManager", () => {
  it("lists the sets with their state and shows progress until cancelled", async () => {
    const { container } = render(<FallbackFontsManager />);
    expect(await screen.findByRole("button", { name: "Remove: Japanese" })).toBeTruthy();
    expect(screen.getByText("C:/data/fallback-fonts")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download: Korean" }));
    });
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(bar.getAttribute("aria-label")).toBe("Korean font download");
    expect((screen.getByRole("button", { name: "Remove: Japanese" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await axeViolations(container)).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel download: Korean" }));
    });
    expect(calls[0].options?.signal?.aborted).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(["The Korean font download was cancelled."]);
  });

  it("removes an installed set", async () => {
    render(<FallbackFontsManager />);
    const remove = await screen.findByRole("button", { name: "Remove: Japanese" });
    await act(async () => {
      fireEvent.click(remove);
    });
    expect(rpc.fallbackFontsRemove).toHaveBeenCalledWith("ja");
    expect(useToastStore.getState().toasts.map((toast) => toast.kind)).toEqual(["success"]);
    expect(rpc.fallbackFonts).toHaveBeenCalledTimes(2);
  });

  it("shows a listing error with a retry", async () => {
    rpc.fallbackFonts.mockRejectedValueOnce(new RpcCallError({ code: "INTERNAL", message: "boom" }));
    render(<FallbackFontsManager />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(await screen.findByRole("button", { name: "Remove: Japanese" })).toBeTruthy();
  });
});
