import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@/shared/store/preferencesStore", () => ({ readPreferences: () => ({ keepBackups: false }) }));

import { openFolder, openProducedFile, openProducedPicture } from "./files";
import { RpcCallError } from "./client";

describe("openProducedPicture", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("asks the shell to open the picture the sidecar just wrote", async () => {
    invoke.mockResolvedValue(undefined);
    await openProducedPicture("C:/Temp/vivepdf-pictures/rapor-resim-3.png");
    expect(invoke).toHaveBeenCalledWith("open_produced_picture", { path: "C:/Temp/vivepdf-pictures/rapor-resim-3.png" });
  });

  it("turns a refusal into an RpcCallError with its code", async () => {
    invoke.mockRejectedValue(Object.assign(new Error("not a picture written by this session"), { code: "PERMISSION_DENIED" }));
    let outcome: unknown = null;
    try {
      await openProducedPicture("C:/Windows/notepad.exe");
    } catch (error) {
      outcome = error;
    }
    expect(outcome).toBeInstanceOf(RpcCallError);
    expect((outcome as RpcCallError).code).toBe("PERMISSION_DENIED");
  });
});

describe("openProducedFile", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("asks the shell to open a document the session wrote", async () => {
    invoke.mockResolvedValue(undefined);

    await openProducedFile("C:/out/rapor.docx");

    expect(invoke).toHaveBeenCalledWith("open_produced_file", { path: "C:/out/rapor.docx" });
  });

  it("turns a refused program into an RpcCallError", async () => {
    invoke.mockRejectedValue(Object.assign(new Error("not a document written by this session"), { code: "PERMISSION_DENIED" }));

    const outcome = await openProducedFile("C:/out/ek.exe").catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(RpcCallError);
    expect((outcome as RpcCallError).code).toBe("PERMISSION_DENIED");
  });

  it("opens folders through their own command", async () => {
    invoke.mockResolvedValue(undefined);

    await openFolder("C:/out");

    expect(invoke).toHaveBeenCalledWith("open_folder", { path: "C:/out" });
  });
});
