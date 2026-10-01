import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { outputClashes, relationKey, resolvePathRelation } from "./pathRelation";

describe("outputClashes", () => {
  it("trusts the canonical answer for the pair it was computed for", () => {
    const resolved = { key: relationKey("C:/in", "C:/link"), relation: { same: true, inside: false } };
    expect(outputClashes("C:/in", "C:/link", resolved)).toBe(true);
  });

  it("falls back to comparing normalised text while the answer is pending or stale", () => {
    const stale = { key: relationKey("C:/in", "C:/old"), relation: { same: true, inside: false } };
    expect(outputClashes("C:/in", "C:/out", stale)).toBe(false);
    expect(outputClashes("C:\\In\\", "c:/in", null)).toBe(true);
  });
});

describe("resolvePathRelation", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("asks the shell for the canonical relation", async () => {
    invoke.mockResolvedValue({ same: true, inside: false });
    await expect(resolvePathRelation("C:/link", "C:/in")).resolves.toEqual({ same: true, inside: false });
    expect(invoke).toHaveBeenCalledWith("watch_path_relation", { path: "C:/link", base: "C:/in" });
  });

  it("degrades to a text comparison when the command fails", async () => {
    invoke.mockRejectedValue(new Error("no shell"));
    await expect(resolvePathRelation("C:/IN/", "c:\\in")).resolves.toEqual({ same: true, inside: false });
  });
});
