import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePathStamps } from "./usePathStamps";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

beforeEach(() => {
  invoke.mockReset();
});

describe("usePathStamps", () => {
  it("maps each path to its stamp and leaves out missing files", async () => {
    invoke.mockResolvedValue(["10-5", null, ""]);

    const { result } = renderHook(() => usePathStamps(["C:/a.pdf", "C:/gone.pdf", "C:/other.pdf"]));

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(invoke).toHaveBeenCalledWith("path_stamps", { paths: ["C:/a.pdf", "C:/gone.pdf", "C:/other.pdf"] });
    expect(result.current.get("C:/a.pdf")).toBe("10-5");
    expect(result.current.has("C:/gone.pdf")).toBe(false);
    expect(result.current.get("C:/other.pdf")).toBe("");
  });

  it("asks nothing when there are no paths", () => {
    const { result } = renderHook(() => usePathStamps([]));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it("stays empty when the shell cannot answer", async () => {
    invoke.mockRejectedValue(new Error("unavailable"));

    const { result } = renderHook(() => usePathStamps(["C:/a.pdf"]));

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(result.current.size).toBe(0);
  });
});
