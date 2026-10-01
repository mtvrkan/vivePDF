import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

let retired: typeof import("@/shared/lib/retiredSettings");
let settings: typeof import("./storedSettings");
let ui: typeof import("./uiStore");
let preferences: typeof import("./preferencesStore");
let reading: typeof import("./readingStore");
let watch: typeof import("./watchStore");
let i18n: typeof import("@/app/i18n");

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "", style: {}, dataset: {}, classList: { toggle: () => false } } });
  localStorage.setItem("vivepdf.pagesZoom", "300");
  localStorage.setItem("vivepdf.theme", "dark");
  localStorage.setItem("vivepdf.reading", JSON.stringify({ fontSize: 30 }));
  localStorage.setItem("vivepdf.preferences", JSON.stringify({ uiScale: 120 }));
  retired = await import("@/shared/lib/retiredSettings");
  settings = await import("./storedSettings");
  ui = await import("./uiStore");
  preferences = await import("./preferencesStore");
  reading = await import("./readingStore");
  watch = await import("./watchStore");
  i18n = await import("@/app/i18n");
  await i18n.ready();
});

beforeEach(() => {
  localStorage.clear();
});

describe("removeRetiredSettings", () => {
  it("deletes the keys of removed features and nothing else", () => {
    localStorage.setItem("vivepdf.sponsor", "{}");
    localStorage.setItem("vivepdf.sponsorDismissed", "1");
    localStorage.setItem("vivepdf.sidebarCollapsed", "true");
    localStorage.setItem("vivepdf.sidebarGroups", "[]");
    localStorage.setItem("vivepdf.theme", "dark");
    localStorage.setItem("other.sponsor", "keep");
    expect(retired.removeRetiredSettings().sort()).toEqual(["vivepdf.sidebarCollapsed", "vivepdf.sidebarGroups", "vivepdf.sponsor", "vivepdf.sponsorDismissed"]);
    expect(localStorage.getItem("vivepdf.theme")).toBe("dark");
    expect(localStorage.getItem("other.sponsor")).toBe("keep");
    expect(localStorage.length).toBe(2);
  });

  it("is a no-op on a clean install", () => {
    expect(retired.removeRetiredSettings()).toEqual([]);
  });
});

describe("resetStoredSettings", () => {
  it("resets stores that cached values at start-up, without waiting for a reload", () => {
    expect(ui.useUiStore.getState().pagesZoom).toBe(300);
    expect(ui.useUiStore.getState().theme).toBe("dark");
    expect(reading.useReadingStore.getState().fontSize).toBe(30);
    expect(preferences.usePreferencesStore.getState().uiScale).toBe(120);
    localStorage.setItem("vivepdf.pagesZoom", "300");
    watch.useWatchStore.setState({ rules: [{} as never] });
    expect(settings.resetStoredSettings(new Set())).toBe(true);
    expect(ui.useUiStore.getState().pagesZoom).toBe(150);
    expect(ui.useUiStore.getState().theme).toBe("system");
    expect(reading.useReadingStore.getState().fontSize).toBe(19);
    expect(preferences.usePreferencesStore.getState().uiScale).toBe(100);
    expect(watch.useWatchStore.getState().rules).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("keeps the listed keys and the stores reading them", () => {
    localStorage.setItem("vivepdf.recent", "[]");
    localStorage.setItem("vivepdf.pagesZoom", "200");
    localStorage.setItem("unrelated", "x");
    settings.resetStoredSettings(new Set(["vivepdf.pagesZoom", "vivepdf.recent"]));
    expect(localStorage.getItem("vivepdf.recent")).toBe("[]");
    expect(localStorage.getItem("unrelated")).toBe("x");
    expect(ui.useUiStore.getState().pagesZoom).toBe(200);
  });

  it("keeps signatures, chains, watch rules and mark presets unless the user asks to delete them", () => {
    const userData = { "vivepdf.signatures": "[1]", "vivepdf.batchChains": "[2]", "vivepdf.watchRules": "[]", "vivepdf.markPresets.v1": "[3]" };
    const fill = () => {
      for (const [key, value] of Object.entries(userData)) localStorage.setItem(key, value);
      localStorage.setItem("vivepdf.theme", "dark");
      localStorage.setItem("vivepdf.recent", "[]");
      localStorage.setItem("vivepdf.searchHistory", '["fatura"]');
    };
    fill();
    expect(settings.resetStoredSettings(settings.keysKeptOnReset(false))).toBe(true);
    for (const [key, value] of Object.entries(userData)) expect(localStorage.getItem(key)).toBe(value);
    expect(localStorage.getItem("vivepdf.theme")).toBeNull();
    expect(localStorage.getItem("vivepdf.searchHistory")).toBe('["fatura"]');

    fill();
    settings.resetStoredSettings(settings.keysKeptOnReset(true));
    for (const key of Object.keys(userData)) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("vivepdf.recent")).toBe("[]");
    expect(localStorage.getItem("vivepdf.searchHistory")).toBe('["fatura"]');
  });

  it("names the storage keys the user-data stores really use", async () => {
    const { CHAINS_STORAGE_KEY } = await import("@/features/tools/batch/chain");
    expect(settings.USER_DATA_KEYS).toContain(CHAINS_STORAGE_KEY);
    for (const key of settings.USER_DATA_KEYS) expect(settings.HISTORY_KEYS).not.toContain(key);
  });

  it("switches the in-memory language back to the detected locale without a reload", async () => {
    await i18n.setLocale("tr");
    ui.useUiStore.setState({ locale: "tr" });
    expect(localStorage.getItem("vivepdf.locale")).toBe("tr");
    expect(settings.resetStoredSettings(new Set())).toBe(true);
    expect(ui.useUiStore.getState().locale).toBe("en");
    await vi.waitFor(() => expect(i18n.default.language).toBe("en"));
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("vivepdf.locale")).toBeNull();
  });

  it("keeps the run-state keys the crash-recovery prompt relies on", () => {
    localStorage.setItem("vivepdf.cleanExit", "false");
    localStorage.setItem("vivepdf.startupOffered", "1");
    localStorage.setItem("vivepdf.theme", "dark");
    settings.resetStoredSettings(settings.keysKeptOnReset(true));
    expect(localStorage.getItem("vivepdf.cleanExit")).toBe("false");
    expect(localStorage.getItem("vivepdf.startupOffered")).toBe("1");
    expect(localStorage.getItem("vivepdf.theme")).toBeNull();
  });

  it("reports failure when storage cannot be read", () => {
    const broken = { ...memoryStorage(), get length(): number { throw new Error("blocked"); } };
    vi.stubGlobal("localStorage", broken);
    try {
      expect(settings.resetStoredSettings(new Set())).toBe(false);
    } finally {
      vi.stubGlobal("localStorage", memoryStorage());
    }
  });
});
