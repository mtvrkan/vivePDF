import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@/shared/lib/reveal", () => ({ revealPath: vi.fn() }));

import { refusedOutput, resultOutlivedSource } from "./useOperation";
import { RpcCallError } from "@/shared/rpc/client";
import { useSourceChangeStore } from "@/shared/store/sourceChangeStore";

describe("resultOutlivedSource", () => {
  it("clears the result once the source document changed", () => {
    expect(resultOutlivedSource(3, 4, false)).toBe(true);
  });

  it("keeps the result while the source stays the same", () => {
    expect(resultOutlivedSource(4, 4, false)).toBe(false);
  });

  it("does not interrupt a run that is still going", () => {
    expect(resultOutlivedSource(3, 4, true)).toBe(false);
  });
});

describe("useSourceChangeStore", () => {
  it("moves the epoch forward on every source change", () => {
    const before = useSourceChangeStore.getState().epoch;
    useSourceChangeStore.getState().changed();
    useSourceChangeStore.getState().changed();
    expect(useSourceChangeStore.getState().epoch).toBe(before + 2);
  });
});

describe("refusedOutput", () => {
  const refusal = (data: Record<string, unknown>) => new RpcCallError({ code: "PERMISSION_DENIED", message: "not granted", data: { reason: "notGranted", ...data } });

  it("names the parameter that holds the refused output", () => {
    expect(refusedOutput({ path: "a.pdf", outputDir: "Parts" }, refusal({ output: "Parts", folder: true }))).toEqual({ keys: ["outputDir"], path: "Parts", folder: true });
  });

  it("finds an output held inside a nested parameter object", () => {
    expect(refusedOutput({ tab: "merge", params: { path: "a.pdf", outputDir: "Merged" } }, refusal({ output: "Merged", folder: true }))).toEqual({ keys: ["params", "outputDir"], path: "Merged", folder: true });
  });

  it("asks for the folder when the refused file was named from an output folder parameter", () => {
    expect(refusedOutput({ files: ["/in/a.docx"], outputDir: "/out" }, refusal({ output: "/out/a.pdf", folder: false }))).toEqual({ keys: ["outputDir"], path: "/out", folder: true });
  });

  it("gives nothing when no top-level parameter holds the refused path", () => {
    expect(refusedOutput({ path: "a.pdf", output: "b.pdf" }, refusal({ output: "c.pdf", folder: false }))).toBeNull();
  });

  it("gives nothing for other errors", () => {
    expect(refusedOutput({ output: "b.pdf" }, new RpcCallError({ code: "INVALID_PARAMS", message: "bad", data: { output: "b.pdf" } }))).toBeNull();
  });
});
