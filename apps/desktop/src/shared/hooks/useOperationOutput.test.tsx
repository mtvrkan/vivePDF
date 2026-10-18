import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCallError } from "@/shared/rpc/client";

const { saveDialog, openDialog } = vi.hoisted(() => ({
  saveDialog: vi.fn<(options: unknown) => Promise<string | null>>(),
  openDialog: vi.fn<(options: unknown) => Promise<string | null>>(),
}));

vi.mock("react-router", () => ({ useLocation: () => ({ pathname: "/tools/compress" }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: saveDialog, open: openDialog }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@/shared/lib/reveal", () => ({ revealPath: vi.fn() }));

import { useOperation } from "./useOperation";

type Params = { path: string; output?: string; outputDir?: string; overwrite?: boolean };

function refusal(output: string, folder: boolean) {
  return new RpcCallError({ code: "PERMISSION_DENIED", message: "not granted", data: { reason: "notGranted", output, folder } });
}

beforeEach(() => {
  saveDialog.mockReset();
  openDialog.mockReset();
});

afterEach(cleanup);

describe("useOperation with an output vivePDF may not write", () => {
  it("asks where to save and runs again at the picked file, replacing it as the save dialog already confirmed", async () => {
    const runner = vi.fn<(params: Params) => Promise<{ output: string }>>().mockRejectedValueOnce(refusal("/docs/report.pdf", false)).mockResolvedValueOnce({ output: "/docs/report-small.pdf" });
    saveDialog.mockResolvedValue("/docs/report-small");
    const { result } = renderHook(() => useOperation(runner));

    await act(async () => {
      await result.current.run({ path: "/docs/in.pdf", output: "/docs/report.pdf" }, { quiet: true });
    });

    expect(saveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/docs/report.pdf" }));
    expect(runner).toHaveBeenLastCalledWith({ path: "/docs/in.pdf", output: "/docs/report-small.pdf", overwrite: true }, expect.anything());
    expect(result.current.status).toBe("success");
  });

  it("asks for a folder and keeps the in-app replace question for the files inside it", async () => {
    const runner = vi.fn<(params: Params) => Promise<{ outputs: string[] }>>().mockRejectedValueOnce(refusal("/docs/Parts", true)).mockResolvedValueOnce({ outputs: [] });
    openDialog.mockResolvedValue("/docs/Chosen");
    const { result } = renderHook(() => useOperation(runner));

    await act(async () => {
      await result.current.run({ path: "/docs/in.pdf", outputDir: "/docs/Parts" }, { quiet: true });
    });

    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ directory: true, defaultPath: "/docs/Parts" }));
    expect(runner).toHaveBeenLastCalledWith({ path: "/docs/in.pdf", outputDir: "/docs/Chosen" }, expect.anything());
  });

  it("puts the picked folder into a nested parameter object", async () => {
    const runner = vi.fn<(params: { tab: string; params: Params; overwrite?: boolean }) => Promise<{ outputs: string[] }>>().mockRejectedValueOnce(refusal("/docs/Merged", true)).mockResolvedValueOnce({ outputs: [] });
    openDialog.mockResolvedValue("/docs/Picked");
    const { result } = renderHook(() => useOperation(runner));

    await act(async () => {
      await result.current.run({ tab: "merge", params: { path: "/docs/in.pdf", outputDir: "/docs/Merged" } }, { quiet: true });
    });

    expect(runner).toHaveBeenLastCalledWith({ tab: "merge", params: { path: "/docs/in.pdf", outputDir: "/docs/Picked" } }, expect.anything());
  });

  it("goes back to idle without an error when the dialog is closed", async () => {
    const runner = vi.fn<(params: Params) => Promise<{ output: string }>>().mockRejectedValue(refusal("/docs/report.pdf", false));
    saveDialog.mockResolvedValue(null);
    const { result } = renderHook(() => useOperation(runner));

    await act(async () => {
      await result.current.run({ path: "/docs/in.pdf", output: "/docs/report.pdf" });
    });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("shows the refusal instead of asking twice when the picked place is refused as well", async () => {
    const runner = vi.fn<(params: Params) => Promise<{ output: string }>>().mockRejectedValueOnce(refusal("/docs/report.pdf", false)).mockRejectedValueOnce(refusal("/docs/other.pdf", false));
    saveDialog.mockResolvedValue("/docs/other.pdf");
    const { result } = renderHook(() => useOperation(runner));

    await act(async () => {
      await result.current.run({ path: "/docs/in.pdf", output: "/docs/report.pdf" });
    });

    expect(saveDialog).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("PERMISSION_DENIED");
  });

  it("does not ask when the refused path is the document being read", async () => {
    const runner = vi.fn<(params: Params) => Promise<{ output: string }>>().mockRejectedValue(new RpcCallError({ code: "PERMISSION_DENIED", message: "not granted", data: { reason: "notGranted" } }));
    const { result } = renderHook(() => useOperation(runner));

    await act(async () => {
      await result.current.run({ path: "/docs/in.pdf", output: "/docs/report.pdf" });
    });

    expect(saveDialog).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
  });
});
