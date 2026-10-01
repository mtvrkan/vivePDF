import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { pathKinds } from "./pathKinds";

describe("pathKinds", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("asks the shell what each dropped path really is", async () => {
    invoke.mockResolvedValue(["directory", "file"]);
    await expect(pathKinds(["C:\\Trip.2024", "C:\\notes"])).resolves.toEqual(["directory", "file"]);
    expect(invoke).toHaveBeenCalledWith("path_kinds", { paths: ["C:\\Trip.2024", "C:\\notes"] });
  });

  it("does not call the shell for an empty drop", async () => {
    await expect(pathKinds([])).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("falls back to the extension when the shell cannot answer", async () => {
    invoke.mockRejectedValue(new Error("offline"));
    await expect(pathKinds(["/x/photos", "/x/a.png"])).resolves.toEqual(["directory", "file"]);
  });
});
