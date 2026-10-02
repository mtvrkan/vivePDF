import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCallError, type RpcCallOptions } from "@/shared/rpc/client";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useFallbackFontsStore } from "@/shared/store/fallbackFontsStore";

const rpc = vi.hoisted(() => ({ fallbackFontsDownload: vi.fn() }));
vi.mock("@/shared/rpc/fallbackFonts", () => rpc);

const { downloadFontSet, noteMissingFont } = await import("./fallbackFonts");

beforeEach(() => {
  rpc.fallbackFontsDownload.mockReset();
  useFallbackFontsStore.setState({ missing: {}, dismissed: {}, downloads: {} });
  useDocumentStore.setState({ activeId: null });
});

describe("noteMissingFont", () => {
  it("attributes a missing set to the active document once", () => {
    useDocumentStore.setState({ activeId: "doc-a" });
    noteMissingFont("ja");
    noteMissingFont("ja");
    noteMissingFont("ko");
    expect(useFallbackFontsStore.getState().missing).toEqual({ "doc-a": ["ja", "ko"] });
  });

  it("ignores a request when no document is active", () => {
    noteMissingFont("ja");
    expect(useFallbackFontsStore.getState().missing).toEqual({});
  });
});

describe("downloadFontSet", () => {
  it("reports progress and marks the set installed", async () => {
    const seen: unknown[] = [];
    rpc.fallbackFontsDownload.mockImplementation(async (_set: string, options?: RpcCallOptions) => {
      options?.onProgress?.({ id: "1", progress: 0.5, message: "progress.downloading", detail: { received: 5, total: 10 } });
      seen.push(useFallbackFontsStore.getState().downloads.ja);
      return { set: "ja", bytes: 10 };
    });
    await expect(downloadFontSet("ja")).resolves.toBe(true);
    expect(seen).toEqual([{ state: "downloading", progress: expect.objectContaining({ detail: { received: 5, total: 10 } }) }]);
    expect(useFallbackFontsStore.getState().downloads.ja).toEqual({ state: "installed" });
  });

  it("keeps the error when the download fails", async () => {
    rpc.fallbackFontsDownload.mockRejectedValue(new RpcCallError({ code: "NETWORK", message: "offline" }));
    await expect(downloadFontSet("ko")).resolves.toBe(false);
    expect(useFallbackFontsStore.getState().downloads.ko).toEqual({ state: "failed", error: expect.objectContaining({ code: "NETWORK" }) });
  });

  it("clears the state when the download is cancelled", async () => {
    rpc.fallbackFontsDownload.mockRejectedValue(new RpcCallError({ code: "CANCELLED", message: "cancelled" }));
    await expect(downloadFontSet("zh-Hans")).resolves.toBe(false);
    expect(useFallbackFontsStore.getState().downloads).toEqual({});
  });

  it("does not start a second download of the same set", async () => {
    useFallbackFontsStore.getState().setDownload("ja", { state: "downloading", progress: null });
    await expect(downloadFontSet("ja")).resolves.toBe(false);
    expect(rpc.fallbackFontsDownload).not.toHaveBeenCalled();
  });
});
