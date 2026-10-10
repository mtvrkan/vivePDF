import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("logger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.resetModules();
    invokeMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("error() calls invoke with level, source and message", async () => {
    const { error } = await import("./logger");
    error("report", "boom");
    expect(invokeMock).toHaveBeenCalledWith("log_line", { level: "error", source: "report", message: "boom" });
  });

  it("throttles two identical calls within the throttle window to a single invoke", async () => {
    const { error } = await import("./logger");
    error("report", "boom");
    error("report", "boom");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("invokes again after the throttle window elapses", async () => {
    const { error } = await import("./logger");
    error("report", "boom");
    vi.advanceTimersByTime(2001);
    error("report", "boom");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("describes an error by its stack so the failing call can be found", async () => {
    const { describeError } = await import("./logger");
    const failure = new Error("state not found");
    expect(describeError(failure, "fallback")).toBe(failure.stack);
  });

  it("describes an error without a stack by its name and message", async () => {
    const { describeError } = await import("./logger");
    const failure = new TypeError("bad value");
    failure.stack = undefined;
    expect(describeError(failure)).toBe("TypeError: bad value");
  });

  it("describes anything else by the fallback or as text", async () => {
    const { describeError } = await import("./logger");
    expect(describeError(undefined, "Script error.")).toBe("Script error.");
    expect(describeError("cancelled")).toBe("cancelled");
  });
});
