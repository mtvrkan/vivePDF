import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listen(...args) }));

import { RpcCallError, rpc, toRpcError } from "./client";

describe("rpc", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });

  it("forwards method and params and returns the result", async () => {
    invoke.mockResolvedValue({ pageCount: 3 });
    const result = await rpc<{ pageCount: number }>("info.get", { path: "a.pdf" });
    expect(result.pageCount).toBe(3);
    const [command, payload] = invoke.mock.calls[0] as [string, { method: string; params: unknown; id: string }];
    expect(command).toBe("rpc");
    expect(payload.method).toBe("info.get");
    expect(payload.params).toEqual({ path: "a.pdf" });
    expect(payload.id).toMatch(/[0-9a-f-]{36}/);
  });

  it("wraps structured errors in RpcCallError with the code preserved", async () => {
    invoke.mockRejectedValue({ code: "NEEDS_PASSWORD", message: "locked" });
    await expect(rpc("info.get", { path: "a.pdf" })).rejects.toMatchObject({
      name: "RpcCallError",
      code: "NEEDS_PASSWORD",
      message: "locked",
    });
  });

  it("maps unknown failures to INTERNAL", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    const error = await rpc("system.ping").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcCallError);
    expect((error as RpcCallError).code).toBe("INTERNAL");
    expect(toRpcError("plain")).toEqual({ code: "INTERNAL", message: "plain" });
  });

  it("subscribes to progress only when a handler is given and unsubscribes after", async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    invoke.mockResolvedValue(null);
    await rpc("compress.run", {}, { onProgress: () => undefined });
    expect(listen).toHaveBeenCalledWith("rpc-progress", expect.any(Function));
    expect(unlisten).toHaveBeenCalledTimes(1);
    await rpc("system.ping");
    expect(listen).toHaveBeenCalledTimes(1);
  });
});
