import { beforeEach, describe, expect, it, vi } from "vitest";

const checkForUpdate = vi.fn<() => Promise<unknown>>(async () => null);

vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => checkForUpdate() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

const { useUpdateStore } = await import("./updateStore");

describe("updateStore.check", () => {
  beforeEach(() => {
    checkForUpdate.mockReset();
    useUpdateStore.setState({ status: "idle", error: null, version: null });
  });

  it("reports up to date when no newer release exists", async () => {
    checkForUpdate.mockResolvedValue(null);
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().status).toBe("upToDate");
  });

  it("reports no update for this system when the release lacks its platform", async () => {
    checkForUpdate.mockRejectedValue(
      new Error('None of the fallback platforms `["darwin-aarch64-app", "darwin-aarch64"]` were found in the response `platforms` object'),
    );
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState()).toMatchObject({ status: "unavailable", error: null });

    checkForUpdate.mockRejectedValue(new Error("the platform `darwin-aarch64` was not found in the response `platforms` object"));
    await useUpdateStore.getState().check(false);
    expect(useUpdateStore.getState()).toMatchObject({ status: "unavailable", error: null });
  });

  it("keeps other failures as errors with their message", async () => {
    checkForUpdate.mockRejectedValue(new Error("error sending request"));
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState()).toMatchObject({ status: "error", error: "error sending request" });
  });
});
