import { afterEach, describe, expect, it } from "vitest";
import { applyStorageChange, followOtherWindows } from "./crossWindowSync";
import { PREFERENCES_KEY, usePreferencesStore } from "@/shared/store/preferencesStore";
import { RECENT_STORAGE_KEY, useRecentStore } from "@/shared/store/recentStore";
import { useUiStore } from "@/shared/store/uiStore";

afterEach(() => {
  localStorage.clear();
  usePreferencesStore.getState().reset();
  useRecentStore.setState({ items: [] });
  useUiStore.setState({ theme: "system" });
  document.documentElement.classList.remove("dark");
});

describe("applyStorageChange", () => {
  it("takes preferences another window saved", () => {
    const current = usePreferencesStore.getState().confirmClose;
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ confirmClose: !current }));
    applyStorageChange(PREFERENCES_KEY);
    expect(usePreferencesStore.getState().confirmClose).toBe(!current);
  });

  it("follows the theme and the recent files list", () => {
    localStorage.setItem("vivepdf.theme", "dark");
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify([{ path: "C:/a.pdf", fileName: "a.pdf", openedAt: 1 }]));
    applyStorageChange("vivepdf.theme");
    expect(useUiStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(useRecentStore.getState().items).toEqual([]);
    applyStorageChange(RECENT_STORAGE_KEY);
    expect(useRecentStore.getState().items.map((item) => item.path)).toEqual(["C:/a.pdf"]);
  });

  it("ignores keys it does not own and reloads everything when storage is cleared", () => {
    localStorage.setItem("vivepdf.theme", "dark");
    applyStorageChange("vivepdf.searchHistory");
    expect(useUiStore.getState().theme).toBe("system");
    applyStorageChange(null);
    expect(useUiStore.getState().theme).toBe("dark");
  });
});

describe("followOtherWindows", () => {
  it("reacts to storage events until stopped", () => {
    const stop = followOtherWindows();
    localStorage.setItem("vivepdf.theme", "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "vivepdf.theme", storageArea: localStorage }));
    expect(useUiStore.getState().theme).toBe("dark");
    stop();
    localStorage.setItem("vivepdf.theme", "light");
    window.dispatchEvent(new StorageEvent("storage", { key: "vivepdf.theme", storageArea: localStorage }));
    expect(useUiStore.getState().theme).toBe("dark");
  });
});
