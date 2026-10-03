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

let guard: typeof import("./closeGuardState");
let preferences: typeof import("@/shared/store/preferencesStore");
let documents: typeof import("@/shared/store/documentStore");
let operations: typeof import("@/shared/store/operationStore");

beforeAll(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  guard = await import("./closeGuardState");
  preferences = await import("@/shared/store/preferencesStore");
  documents = await import("@/shared/store/documentStore");
  operations = await import("@/shared/store/operationStore");
});

beforeEach(() => {
  localStorage.clear();
  preferences.usePreferencesStore.getState().reset();
  documents.useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  operations.useOperationStore.setState({ running: 0 });
});

describe("close guard", () => {
  it("stays silent while no guard is listening, so the window can always close", () => {
    preferences.usePreferencesStore.getState().update({ confirmClose: true });
    documents.useDocumentStore.getState().register("a", "a.pdf", null);
    expect(guard.shouldConfirmClose()).toBeNull();
  });

  it("warns about open documents and running operations once a guard is listening", () => {
    const unregister = guard.registerCloseGuard();
    preferences.usePreferencesStore.getState().update({ confirmClose: true });
    expect(guard.shouldConfirmClose()).toBeNull();
    documents.useDocumentStore.getState().register("a", "a.pdf", null);
    expect(guard.shouldConfirmClose()).toEqual({ documents: 1, operations: 0 });
    operations.useOperationStore.getState().begin();
    expect(guard.shouldConfirmClose()).toEqual({ documents: 1, operations: 1 });
    unregister();
    expect(guard.shouldConfirmClose()).toBeNull();
  });

  it("stays silent while the preference is off", () => {
    const unregister = guard.registerCloseGuard();
    documents.useDocumentStore.getState().register("a", "a.pdf", null);
    expect(guard.shouldConfirmClose()).toBeNull();
    unregister();
  });

  it("stops warning after the user confirms the close", () => {
    const unregister = guard.registerCloseGuard();
    preferences.usePreferencesStore.getState().update({ confirmClose: true });
    documents.useDocumentStore.getState().register("a", "a.pdf", null);
    expect(guard.shouldConfirmClose()).not.toBeNull();
    guard.allowClose();
    expect(guard.shouldConfirmClose()).toBeNull();
    unregister();
  });

  it("hides to the tray instead of closing while the tray is on, until the user quits", () => {
    expect(guard.hidesOnClose()).toBe(false);
    guard.setTrayActive(true);
    expect(guard.hidesOnClose()).toBe(true);
    guard.requestQuit();
    expect(guard.hidesOnClose()).toBe(false);
    guard.cancelQuit();
    expect(guard.hidesOnClose()).toBe(true);
    guard.setTrayActive(false);
    expect(guard.hidesOnClose()).toBe(false);
  });
});
