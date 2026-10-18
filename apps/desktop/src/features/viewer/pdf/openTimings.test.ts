import { describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@/shared/lib/logger", () => logger);

const { openTimer, sourceDetail } = await import("./openTimings");

describe("openTimer", () => {
  it("logs how long each opening step took and the total", () => {
    const times = [0, 4, 54.4, 210, 230, 230];
    const timer = openTimer(() => times.shift() ?? 230);

    timer.step("claim");
    timer.step("read");
    timer.step("engine");
    timer.step("show");
    timer.log("2.0 MB");

    expect(logger.info).toHaveBeenCalledWith("open", "2.0 MB: claim 4 ms, read 50 ms, engine 156 ms, show 20 ms, total 230 ms");
  });

  it("gives only the total when no step was marked", () => {
    expect(openTimer(() => 0).summary()).toBe("total 0 ms");
  });

  it("describes a whole file by its size and a large one as read in ranges", () => {
    expect(sourceDetail({ kind: "buffer", buffer: new ArrayBuffer(3 * 1048576) })).toBe("3.0 MB");
    expect(sourceDetail({ kind: "range" })).toBe("in ranges");
  });
});
