import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotchInset } from "./useNotchInset";

const invoke = vi.fn();
const handlers = new Map<string, () => void>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: (event: string, handler: () => void) => {
      handlers.set(event, handler);
      return Promise.resolve(() => handlers.delete(event));
    },
  }),
}));

beforeEach(() => {
  invoke.mockReset();
  handlers.clear();
});

describe("useNotchInset", () => {
  it("takes the band the screen keeps for its camera notch", async () => {
    invoke.mockResolvedValue(32);

    const { result } = renderHook(() => useNotchInset());

    await waitFor(() => expect(result.current).toBe(32));
    expect(invoke).toHaveBeenCalledWith("presenter_inset");
  });

  it("measures again when the audience window lands on another screen", async () => {
    invoke.mockResolvedValueOnce(32).mockResolvedValueOnce(0);
    const { result } = renderHook(() => useNotchInset());
    await waitFor(() => expect(result.current).toBe(32));

    act(() => handlers.get("presenter:placed")?.());

    await waitFor(() => expect(result.current).toBe(0));
  });

  it("keeps no band when the measure fails or makes no sense", async () => {
    invoke.mockRejectedValueOnce(new Error("no window")).mockResolvedValueOnce(Number.NaN);
    const { result } = renderHook(() => useNotchInset());
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    act(() => handlers.get("presenter:placed")?.());

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(0);
  });
});
