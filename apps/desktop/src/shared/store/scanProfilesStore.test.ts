import { beforeEach, describe, expect, it } from "vitest";

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
  key: () => null,
  length: 0,
};

const { SCAN_PROFILES_KEY, readStored, useScanProfilesStore } = await import("./scanProfilesStore");

const settings = { source: "feeder", dpi: 300, mode: "gray", sheets: 0, duplex: true, deskew: true, despeckle: false, whiten: true, skipBlank: true, ocr: true, autoName: true } as const;

describe("scan profiles", () => {
  beforeEach(() => {
    storage.clear();
    useScanProfilesStore.setState({ profiles: [] });
  });

  it("saves a profile and replaces one with the same name", () => {
    const first = useScanProfilesStore.getState().save("Faturalar", settings);
    const second = useScanProfilesStore.getState().save(" faturalar ", { ...settings, dpi: 200 });
    expect(second.id).toBe(first.id);
    expect(useScanProfilesStore.getState().profiles).toHaveLength(1);
    expect(readStored()[0].settings.dpi).toBe(200);
  });

  it("drops stored profiles with broken settings", () => {
    storage.set(SCAN_PROFILES_KEY, JSON.stringify([{ id: "a", name: "ok", settings }, { id: "b", name: "bozuk", settings: { ...settings, mode: "sepia" } }, "x"]));
    expect(readStored().map((item) => item.id)).toEqual(["a"]);
  });

  it("reads nothing from unreadable storage", () => {
    storage.set(SCAN_PROFILES_KEY, "{not json");
    expect(readStored()).toEqual([]);
  });
});
