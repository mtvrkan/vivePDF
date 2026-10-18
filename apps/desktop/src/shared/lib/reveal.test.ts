import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { RevealError, revealPath, sameDirectory } from "./reveal";

describe("revealPath", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("throws immediately for an empty path without calling the shell", async () => {
    await expect(revealPath("   ")).rejects.toMatchObject({ reasonKey: "errors.revealEmptyPath" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reveals the path through the gated shell command", async () => {
    invoke.mockResolvedValue(undefined);

    await revealPath("C:\\Users\\PC\\Desktop\\pdf\\file.pdf");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("reveal_path", { path: "C:\\Users\\PC\\Desktop\\pdf\\file.pdf" });
  });

  it("opens the parent folder when the file itself cannot be revealed", async () => {
    invoke.mockRejectedValueOnce(new Error("not found")).mockResolvedValueOnce(undefined);

    await revealPath("C:\\Users\\PC\\Desktop\\pdf\\missing.pdf");

    expect(invoke).toHaveBeenLastCalledWith("open_folder", { path: "C:\\Users\\PC\\Desktop\\pdf" });
  });

  it("throws RevealError with errors.revealFailed when the folder cannot be opened either", async () => {
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
