import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useToastStore } from "@/shared/store/toastStore";
import { useUpdateStore } from "@/shared/store/updateStore";
import { checkUpdatesNow, openLogFolder } from "./helpActions";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

describe("help actions", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    tauri.invoke.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it("opens the log folder without a message when it works", async () => {
    tauri.invoke.mockResolvedValue(undefined);

    await openLogFolder();

    expect(tauri.invoke).toHaveBeenCalledWith("open_log_dir");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("shows an error when the log folder cannot be opened", async () => {
    tauri.invoke.mockRejectedValue({ code: "INTERNAL", message: "no file manager" });

    await openLogFolder();

    expect(useToastStore.getState().toasts.at(-1)?.kind).toBe("error");
  });

  it("goes to the update settings and starts a check", () => {
    const check = vi.fn().mockResolvedValue(undefined);
    useUpdateStore.setState({ check });
    const navigate = vi.fn();

    checkUpdatesNow(navigate);

    expect(navigate).toHaveBeenCalledWith("/settings?section=updates");
    expect(check).toHaveBeenCalledWith(true);
  });
});
