import { beforeEach, describe, expect, it, vi } from "vitest";

const revealItemInDir = vi.fn();
const openPath = vi.fn();
const invoke = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: (...args: unknown[]) => revealItemInDir(...args),
  openPath: (...args: unknown[]) => openPath(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { RevealError, revealPath, sameDirectory } from "./reveal";

describe("revealPath", () => {
  beforeEach(() => {
    revealItemInDir.mockReset();
    openPath.mockReset();
    invoke.mockReset();
  });

  it("throws immediately for an empty path without calling any plugin fn", async () => {
    await expect(revealPath("   ")).rejects.toMatchObject({ reasonKey: "errors.revealEmptyPath" });
    expect(revealItemInDir).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reveals the path directly when the primary call succeeds", async () => {
    revealItemInDir.mockResolvedValue(undefined);
    await revealPath("C:\\Users\\PC\\Desktop\\pdf\\file.pdf");
    expect(revealItemInDir).toHaveBeenCalledTimes(1);
    expect(revealItemInDir).toHaveBeenCalledWith("C:\\Users\\PC\\Desktop\\pdf\\file.pdf");
    expect(openPath).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("falls back to revealing the parent directory when the primary call fails", async () => {
    revealItemInDir.mockRejectedValueOnce(new Error("not found")).mockResolvedValueOnce(undefined);
    await revealPath("C:\\Users\\PC\\Desktop\\pdf\\missing.pdf");
    expect(revealItemInDir).toHaveBeenCalledTimes(2);
    expect(revealItemInDir).toHaveBeenNthCalledWith(2, "C:\\Users\\PC\\Desktop\\pdf");
    expect(openPath).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes the Rust fallback when every JS attempt fails", async () => {
    revealItemInDir.mockRejectedValue(new Error("fail"));
    openPath.mockRejectedValue(new Error("fail"));
    invoke.mockResolvedValue(undefined);
    await revealPath("C:\\Users\\PC\\Desktop\\pdf\\missing.pdf");
    expect(invoke).toHaveBeenCalledWith("reveal_path", { path: "C:\\Users\\PC\\Desktop\\pdf\\missing.pdf" });
  });

  it("throws RevealError with errors.revealFailed when every fallback fails", async () => {
    revealItemInDir.mockRejectedValue(new Error("fail"));
    openPath.mockRejectedValue(new Error("fail"));
    invoke.mockRejectedValue(new Error("fail"));
    await expect(revealPath("C:\\Users\\PC\\Desktop\\pdf\\missing.pdf")).rejects.toMatchObject({
      reasonKey: "errors.revealFailed",
    });
    await expect(revealPath("x.pdf")).rejects.toBeInstanceOf(RevealError);
  });
});

describe("sameDirectory", () => {
  it("returns the shared parent directory when all paths match", () => {
    expect(
      sameDirectory(["C:\\Users\\PC\\Desktop\\pdf\\a.pdf", "C:\\Users\\PC\\Desktop\\pdf\\b.pdf"]),
    ).toBe("C:\\Users\\PC\\Desktop\\pdf");
  });

  it("returns null when parent directories differ", () => {
    expect(
      sameDirectory(["C:\\Users\\PC\\Desktop\\pdf\\a.pdf", "C:\\Users\\PC\\Desktop\\other\\b.pdf"]),
    ).toBeNull();
  });
});
