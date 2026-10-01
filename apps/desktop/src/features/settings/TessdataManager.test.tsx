import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCallError, type RpcCallOptions } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { axeViolations } from "@/test/axe";

const calls: { code: string; options?: RpcCallOptions }[] = [];

vi.mock("@/shared/rpc/tessdata", () => ({
  tessdataLanguages: vi.fn(async () => ({ directory: "C:/tessdata", installed: ["eng", "tur"], available: [{ code: "eng", name: "English" }, { code: "lat", name: "Latin" }] })),
  tessdataRemove: vi.fn(async () => ({ code: "lat", removed: true })),
  tessdataDownload: vi.fn(
    (code: string, options?: RpcCallOptions) =>
      new Promise((_resolve, reject) => {
        calls.push({ code, options });
        options?.onProgress?.({ id: "1", progress: 0.4, message: "progress.downloading", detail: { received: 40, total: 100 } });
        options?.signal?.addEventListener("abort", () => reject(new RpcCallError({ code: "CANCELLED", message: "operation cancelled" })));
      }),
  ),
}));

const { TessdataManager } = await import("./TessdataManager");

beforeEach(() => {
  calls.length = 0;
  useToastStore.setState({ toasts: [], held: false });
});

afterEach(cleanup);

describe("TessdataManager", () => {
  it("shows an accessible progress bar while downloading and cancels the request", async () => {
    const { container } = render(<TessdataManager />);
    const download = await screen.findByRole("button", { name: "Download: Latin" });
    await act(async () => {
      fireEvent.click(download);
    });
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-label")).toBe("Downloading Latin");
    expect(await axeViolations(container)).toEqual([]);

    const cancel = screen.getByRole("button", { name: "Cancel download: Latin" });
    await act(async () => {
      fireEvent.click(cancel);
    });
    expect(calls[0].options?.signal?.aborted).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((toast) => toast.kind)).toEqual(["info"]);
    expect(toasts[0].message).toBe("Download of lat cancelled.");
  });
});
