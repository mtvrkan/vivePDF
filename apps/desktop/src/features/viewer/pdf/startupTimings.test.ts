import { describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@/shared/lib/logger", () => logger);

const { STARTUP_MARKS, logStartupReady, markOnce, startupSummary } = await import("./startupTimings");

function timings(times: Record<string, number>) {
  return { getEntriesByName: (name: string) => (name in times ? [{ startTime: times[name] } as PerformanceEntry] : []) };
}

describe("startupTimings", () => {
  it("lists every startup step in order with rounded times", () => {
    const source = timings({ [STARTUP_MARKS.script]: 41.6, [STARTUP_MARKS.mount]: 120, [STARTUP_MARKS.engine]: 122.2, "first-contentful-paint": 140, [STARTUP_MARKS.ready]: 480.4 });

    expect(startupSummary(source)).toBe("script 42 ms, mount 120 ms, engine start 122 ms, first paint 140 ms, ready 480 ms");
  });

  it("shows a dash for a step the web view did not record", () => {
    expect(startupSummary(timings({ [STARTUP_MARKS.ready]: 300 }))).toBe("script -, mount -, engine start -, first paint -, ready 300 ms");
  });

  it("writes the summary to the log only once and marks a name only once", () => {
    const marks: string[] = [];
    const source = { getEntriesByName: (name: string) => (marks.includes(name) ? [{ startTime: 1 } as PerformanceEntry] : []), mark: (name: string) => marks.push(name) as unknown as PerformanceMark };

    logStartupReady(timings({}));
    logStartupReady(timings({}));
    markOnce("a", source);
    markOnce("a", source);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("startup", expect.stringContaining("ready -"));
    expect(marks).toEqual(["a"]);
  });
});
