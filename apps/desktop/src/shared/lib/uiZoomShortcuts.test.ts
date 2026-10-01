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

let shortcuts: typeof import("./uiZoomShortcuts");
let preferences: typeof import("@/shared/store/preferencesStore");
let toasts: typeof import("@/shared/store/toastStore");

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "", style: { fontSize: "" }, dataset: {}, classList: { toggle: () => false } } });
  vi.stubGlobal("window", { setTimeout: () => 0 });
  shortcuts = await import("./uiZoomShortcuts");
  preferences = await import("@/shared/store/preferencesStore");
  toasts = await import("@/shared/store/toastStore");
});

beforeEach(() => {
  localStorage.clear();
  preferences.usePreferencesStore.setState({ ...preferences.DEFAULT_PREFERENCES });
  toasts.useToastStore.setState({ toasts: [] });
});

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, ...init } as KeyboardEvent;
}

describe("handleUiZoomKey", () => {
  it("steps the persisted interface zoom and replaces the previous announcement", () => {
    const now = (run: () => void) => run();
    expect(shortcuts.handleUiZoomKey(keyEvent({ key: "=", code: "Equal", ctrlKey: true }), now)).toBe(true);
    expect(shortcuts.handleUiZoomKey(keyEvent({ key: "=", code: "Equal", ctrlKey: true }), now)).toBe(true);
    expect(preferences.usePreferencesStore.getState().uiZoom).toBe(1.25);
    expect(JSON.parse(localStorage.getItem(preferences.PREFERENCES_KEY) ?? "{}").uiZoom).toBe(1.25);
    expect(document.documentElement.style.fontSize).toBe("125%");
    expect(toasts.useToastStore.getState().toasts).toHaveLength(1);
    shortcuts.handleUiZoomKey(keyEvent({ key: "0", code: "Digit0", ctrlKey: true }), now);
    expect(preferences.usePreferencesStore.getState().uiZoom).toBe(1);
  });

  it("leaves the key to a page that already handled it, such as the viewer zoom", () => {
    const queued: Array<() => void> = [];
    const event = keyEvent({ key: "-", code: "Minus", ctrlKey: true });
    expect(shortcuts.handleUiZoomKey(event, (run) => queued.push(run))).toBe(true);
    Object.assign(event, { defaultPrevented: true });
    queued.forEach((run) => run());
    expect(preferences.usePreferencesStore.getState().uiZoom).toBe(1);
    expect(shortcuts.handleUiZoomKey(keyEvent({ key: "-", code: "Minus", ctrlKey: true, defaultPrevented: true }))).toBe(false);
    expect(shortcuts.handleUiZoomKey(keyEvent({ key: "a", code: "KeyA", ctrlKey: true }))).toBe(false);
  });
});

describe("preferences uiZoom", () => {
  it("rejects zoom values that are not one of the steps", () => {
    localStorage.setItem(preferences.PREFERENCES_KEY, JSON.stringify({ uiZoom: 7 }));
    expect(preferences.readPreferences().uiZoom).toBe(1);
    localStorage.setItem(preferences.PREFERENCES_KEY, JSON.stringify({ uiZoom: 1.5 }));
    expect(preferences.readPreferences().uiZoom).toBe(1.5);
  });
});
