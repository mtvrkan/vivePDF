import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCallError, type RpcCallOptions } from "@/shared/rpc/client";
import { translateText } from "@/shared/rpc/operations";

vi.mock("@/shared/rpc/operations", () => ({ translateText: vi.fn() }));
vi.mock("@/shared/store/uiStore", () => ({ useUiStore: { getState: () => ({ locale: "en" }) } }));

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

vi.stubGlobal("localStorage", memoryStorage());

const { MAX_TRANSLATION_CHARS, readStored, useTranslationStore } = await import("./translationStore");

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(translateText).mockReset().mockImplementation(async ({ text, source, target }) => ({ text: `[${target}] ${text}`, source, target, route: [`${source}_${target}`] }));
  useTranslationStore.setState({ text: "", truncated: false, status: "idle", progress: null, result: null, error: null, source: "en", target: "tr" });
});

describe("translationStore", () => {
  it("translates a requested selection with the chosen pair", async () => {
    useTranslationStore.getState().request("  Hello world  ");
    await settle();
    const state = useTranslationStore.getState();
    expect(translateText).toHaveBeenCalledWith({ text: "Hello world", source: "en", target: "tr" }, expect.anything());
    expect(state.status).toBe("done");
    expect(state.result?.text).toBe("[tr] Hello world");
  });

  it("cuts long selections to the limit and flags the cut", async () => {
    useTranslationStore.getState().request("a".repeat(MAX_TRANSLATION_CHARS + 10));
    await settle();
    expect(useTranslationStore.getState().text).toHaveLength(MAX_TRANSLATION_CHARS);
    expect(useTranslationStore.getState().truncated).toBe(true);
  });

  it("waits for both languages before translating", async () => {
    useTranslationStore.setState({ source: null });
    useTranslationStore.getState().request("Hello");
    await settle();
    expect(translateText).not.toHaveBeenCalled();
    expect(useTranslationStore.getState().status).toBe("idle");
  });

  it("swaps the pair, remembers it and translates again", async () => {
    useTranslationStore.setState({ text: "Merhaba" });
    useTranslationStore.getState().swap();
    await settle();
    expect(useTranslationStore.getState()).toMatchObject({ source: "tr", target: "en", status: "done" });
    expect(readStored()).toEqual({ source: "tr", target: "en" });
  });

  it("keeps the engine error for a missing pair", async () => {
    vi.mocked(translateText).mockRejectedValueOnce(new RpcCallError({ code: "UNSUPPORTED", message: "missing", data: { reason: "translationPairMissing", missing: ["en_tr"] } }));
    useTranslationStore.getState().request("Hello");
    await settle();
    expect(useTranslationStore.getState().status).toBe("error");
    expect(useTranslationStore.getState().error?.data?.missing).toEqual(["en_tr"]);
  });

  it("returns to idle when the running translation is cancelled", async () => {
    vi.mocked(translateText).mockImplementationOnce(
      (_params, options?: RpcCallOptions) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new RpcCallError({ code: "CANCELLED", message: "operation cancelled" })));
        }),
    );
    useTranslationStore.getState().request("Hello");
    expect(useTranslationStore.getState().status).toBe("loading");
    useTranslationStore.getState().cancel();
    await settle();
    expect(useTranslationStore.getState().status).toBe("idle");
    expect(useTranslationStore.getState().error).toBeNull();
  });

  it("defaults to no source when the interface is already English", () => {
    expect(readStored()).toEqual({ source: null, target: "en" });
  });

  it("ignores stored languages that are not plain codes", () => {
    localStorage.setItem("vivepdf.translation", JSON.stringify({ source: "../x", target: "de" }));
    expect(readStored()).toEqual({ source: null, target: "de" });
  });
});
