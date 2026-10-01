import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCallError, type RpcCallOptions } from "@/shared/rpc/client";

const signals: AbortSignal[] = [];

vi.mock("@/shared/rpc/operations", () => ({
  ttsVoices: vi.fn(async () => ({ directory: "C:/tts", voices: [] })),
  ttsRemove: vi.fn(async () => ({ id: "x", installed: [] })),
  ttsImport: vi.fn(async () => ({ id: "x", installed: [] })),
  ttsDownload: vi.fn(
    (_id: string, options?: RpcCallOptions) =>
      new Promise((_resolve, reject) => {
        if (options?.signal) signals.push(options.signal);
        options?.onProgress?.({ id: "1", progress: 0.5, message: "progress.downloading" });
        options?.signal?.addEventListener("abort", () => reject(new RpcCallError({ code: "CANCELLED", message: "operation cancelled" })));
      }),
  ),
}));

const { useTtsVoicesStore } = await import("./ttsVoicesStore");

beforeEach(() => {
  signals.length = 0;
  useTtsVoicesStore.setState({ downloadingId: null, downloadProgress: null });
});

describe("ttsVoicesStore download cancel", () => {
  it("aborts the running download and clears the busy state", async () => {
    const pending = useTtsVoicesStore.getState().downloadVoice("tr_TR-dfki-medium");
    expect(useTtsVoicesStore.getState().downloadingId).toBe("tr_TR-dfki-medium");
    expect(useTtsVoicesStore.getState().downloadProgress?.progress).toBe(0.5);
    useTtsVoicesStore.getState().cancelDownload();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(signals[0].aborted).toBe(true);
    expect(useTtsVoicesStore.getState().downloadingId).toBeNull();
    expect(useTtsVoicesStore.getState().downloadProgress).toBeNull();
  });

  it("is a no-op when nothing is downloading", () => {
    expect(() => useTtsVoicesStore.getState().cancelDownload()).not.toThrow();
    expect(useTtsVoicesStore.getState().downloadingId).toBeNull();
  });
});
