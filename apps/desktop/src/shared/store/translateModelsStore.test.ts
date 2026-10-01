import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCallError, type RpcCallOptions } from "@/shared/rpc/client";
import { translateDownload, translateModels, translateRemove } from "@/shared/rpc/operations";

const signals: AbortSignal[] = [];
const model = { id: "en_tr", source: "en", target: "tr", version: "2.0", sizeMb: 225, installed: false, origin: "catalog" as const };
const reverse = { ...model, id: "tr_en", source: "tr", target: "en" };

vi.mock("@/shared/rpc/operations", () => ({
  translateModels: vi.fn(async () => ({ directory: "C:/translate", models: [] })),
  translateRemove: vi.fn(async () => ({ id: "x", installed: [] })),
  translateDownload: vi.fn(),
}));

const { useTranslateModelsStore } = await import("./translateModelsStore");

beforeEach(() => {
  signals.length = 0;
  vi.mocked(translateModels).mockReset().mockResolvedValue({ directory: "C:/translate", models: [model, reverse] });
  vi.mocked(translateRemove).mockClear();
  vi.mocked(translateDownload).mockReset().mockImplementation(
    (_id: string, options?: RpcCallOptions) =>
      new Promise((_resolve, reject) => {
        if (options?.signal) signals.push(options.signal);
        options?.onProgress?.({ id: "1", progress: 0.5, message: "progress.downloading" });
        options?.signal?.addEventListener("abort", () => reject(new RpcCallError({ code: "CANCELLED", message: "operation cancelled" })));
      }),
  );
  useTranslateModelsStore.setState({ models: [model, reverse], directory: null, loading: false, loaded: false, error: null, downloadingLanguage: null, downloadProgress: null });
});

describe("translateModelsStore", () => {
  it("loads the catalog and the models folder", async () => {
    await useTranslateModelsStore.getState().refresh();
    const state = useTranslateModelsStore.getState();
    expect(state.models).toEqual([model, reverse]);
    expect(state.directory).toBe("C:/translate");
    expect(state.loaded).toBe(true);
    expect(state.error).toBeNull();
  });

  it("downloads every missing direction of a language pack and refreshes the list", async () => {
    const progress: number[] = [];
    vi.mocked(translateDownload).mockImplementation(async (id: string, options?: RpcCallOptions) => {
      options?.onProgress?.({ id: "1", progress: 0.5, message: "progress.downloading" });
      progress.push(useTranslateModelsStore.getState().downloadProgress?.progress ?? -1);
      return { id, installed: [id] };
    });
    vi.mocked(translateModels).mockResolvedValueOnce({ directory: "C:/translate", models: [{ ...model, installed: true }, { ...reverse, installed: true }] });
    useTranslateModelsStore.setState({ models: [model, { ...reverse, installed: false }] });
    await useTranslateModelsStore.getState().downloadLanguage("tr");
    expect(vi.mocked(translateDownload).mock.calls.map(([id]) => id)).toEqual(["tr_en", "en_tr"]);
    expect(progress).toEqual([0.25, 0.75]);
    expect(useTranslateModelsStore.getState().models.every((item) => item.installed)).toBe(true);
    expect(useTranslateModelsStore.getState().downloadingLanguage).toBeNull();
  });

  it("completes a half installed pack by downloading only the missing direction", async () => {
    vi.mocked(translateDownload).mockResolvedValue({ id: "en_tr", installed: ["en_tr", "tr_en"] });
    useTranslateModelsStore.setState({ models: [model, { ...reverse, installed: true }] });
    await useTranslateModelsStore.getState().downloadLanguage("tr");
    expect(vi.mocked(translateDownload).mock.calls.map(([id]) => id)).toEqual(["en_tr"]);
  });

  it("aborts the running download, clears the busy state and keeps what finished", async () => {
    const pending = useTranslateModelsStore.getState().downloadLanguage("tr");
    expect(useTranslateModelsStore.getState().downloadingLanguage).toBe("tr");
    expect(useTranslateModelsStore.getState().downloadProgress?.progress).toBe(0.25);
    useTranslateModelsStore.getState().cancelDownload();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(signals[0].aborted).toBe(true);
    expect(translateDownload).toHaveBeenCalledTimes(1);
    expect(translateModels).toHaveBeenCalled();
    expect(useTranslateModelsStore.getState().downloadingLanguage).toBeNull();
    expect(useTranslateModelsStore.getState().downloadProgress).toBeNull();
  });

  it("removes every installed direction of a language", async () => {
    useTranslateModelsStore.setState({ models: [{ ...model, installed: true }, { ...reverse, installed: true }] });
    await useTranslateModelsStore.getState().removeLanguage("tr");
    expect(vi.mocked(translateRemove).mock.calls.map(([id]) => id)).toEqual(["tr_en", "en_tr"]);
  });

  it("keeps the error message when the catalog cannot be read", async () => {
    vi.mocked(translateModels).mockRejectedValueOnce(new Error("engine gone"));
    await useTranslateModelsStore.getState().refresh();
    expect(useTranslateModelsStore.getState().error).toBe("engine gone");
    expect(useTranslateModelsStore.getState().loading).toBe(false);
  });
});
