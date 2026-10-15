import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useEngineStore } from "@/shared/store/engineStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUpdateStore } from "@/shared/store/updateStore";

const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<undefined>>(async () => undefined);
const openUrl = vi.fn<(url: string) => Promise<undefined>>(async () => undefined);
const checkForUpdate = vi.fn(async () => null);

vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => checkForUpdate() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

const { refuseWhenOffline, syncNetworkMode } = await import("./offline");
const { openExternal } = await import("./openExternal");

const setOffline = (offlineMode: boolean) => usePreferencesStore.getState().update({ offlineMode });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const networkModeCalls = () =>
  invoke.mock.calls.filter(([command, args]) => command === "set_offline_mode" || (command === "rpc" && args?.method === "system.network_mode"));

describe("offline mode", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    invoke.mockClear();
    openUrl.mockClear();
    checkForUpdate.mockClear();
    setOffline(false);
    useToastStore.setState({ toasts: [], held: false });
    useEngineStore.setState({ status: "idle" });
    useUpdateStore.setState({ status: "idle" });
  });

  it("lets network actions through while online", () => {
    expect(refuseWhenOffline()).toBe(false);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("refuses with an explanation while offline", () => {
    setOffline(true);

    expect(refuseWhenOffline()).toBe(true);

    const [toast] = useToastStore.getState().toasts;
    expect(toast.kind).toBe("error");
    expect(toast.message).toBe("This needs the internet, but offline mode is on. Turn it off in Settings › Web.");
  });

  it("does not open web links while offline", async () => {
    setOffline(true);

    await openExternal("https://vivepdf.com/");

    expect(openUrl).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("still refuses non-web links before the offline check", async () => {
    setOffline(true);

    await expect(openExternal("file:///C:/x.pdf")).rejects.toThrow("Unsupported protocol");
  });

  it("skips the update check instead of failing", async () => {
    setOffline(true);

    await useUpdateStore.getState().check(true);

    expect(checkForUpdate).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("offline");
  });

  it("tells the shell and the engine about the switch, and again when the engine restarts", async () => {
    const stop = syncNetworkMode();
    await flush();
    expect(networkModeCalls().map(([command]) => command)).toEqual(["set_offline_mode"]);

    useEngineStore.setState({ status: "success" });
    await flush();
    setOffline(true);
    await flush();
    stop();
    setOffline(false);
    await flush();

    expect(networkModeCalls().map(([command, args]) => [command, args?.offline ?? (args?.params as { offline: boolean }).offline])).toEqual([
      ["set_offline_mode", false],
      ["set_offline_mode", false],
      ["rpc", false],
      ["set_offline_mode", true],
      ["rpc", true],
    ]);
  });
});
