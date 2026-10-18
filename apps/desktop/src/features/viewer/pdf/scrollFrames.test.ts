import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@/shared/lib/logger", () => logger);

const { frameStats, scrollSummary, watchScrollFrames } = await import("./scrollFrames");

function fakeClock() {
  let frames: Array<(time: number) => void> = [];
  let timer: (() => void) | null = null;
  return {
    clock: {
      now: () => 0,
      frame: (callback: (time: number) => void) => frames.push(callback),
      cancelFrame: () => {
        frames = [];
      },
      later: (callback: () => void) => {
        timer = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearLater: () => {
        timer = null;
      },
    },
    paint(times: number[]) {
      for (const time of times) {
        const pending = frames;
        frames = [];
        pending.forEach((callback) => callback(time));
      }
    },
    idle() {
      timer?.();
    },
  };
}

beforeEach(() => logger.info.mockReset());

describe("frameStats", () => {
  it("summarises frame gaps with the slow ones counted", () => {
    const stats = frameStats([16, 16, 17, 50, 16]);

    expect(stats).toMatchObject({ frames: 5, worst: 50, p95: 50, slow: 1 });
    expect(scrollSummary(stats)).toBe("5 frames, average 23.0 ms, p95 50 ms, worst 50 ms, 1 over 34 ms");
  });

  it("gives zeros for no frames", () => {
    expect(frameStats([])).toEqual({ frames: 0, average: 0, p95: 0, worst: 0, slow: 0 });
  });
});

describe("watchScrollFrames", () => {
  it("logs one summary of the frames painted while scrolling once the scrolling stops", () => {
    const target = new EventTarget();
    const fake = fakeClock();
    watchScrollFrames(target, fake.clock);

    target.dispatchEvent(new Event("scroll"));
    fake.paint(Array.from({ length: 13 }, (_, index) => index * 16));
    target.dispatchEvent(new Event("scroll"));
    fake.idle();

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("scroll", "12 frames, average 16.0 ms, p95 16 ms, worst 16 ms, 0 over 34 ms");
  });

  it("logs nothing for a nudge too short to judge", () => {
    const target = new EventTarget();
    const fake = fakeClock();
    watchScrollFrames(target, fake.clock);

    target.dispatchEvent(new Event("scroll"));
    fake.paint([0, 16, 32]);
    fake.idle();

    expect(logger.info).not.toHaveBeenCalled();
  });

  it("stops listening once it is undone", () => {
    const target = new EventTarget();
    const fake = fakeClock();
    const stop = watchScrollFrames(target, fake.clock);

    stop();
    target.dispatchEvent(new Event("scroll"));
    fake.paint(Array.from({ length: 20 }, (_, index) => index * 16));
    fake.idle();

    expect(logger.info).not.toHaveBeenCalled();
  });
});
