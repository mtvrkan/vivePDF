import { describe, expect, it } from "vitest";
import { createLaneScheduler, watchLane } from "./watchScheduler";

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLaneScheduler", () => {
  it("runs independent lanes concurrently up to the limit", async () => {
    const scheduler = createLaneScheduler(2);
    const started: string[] = [];
    const gates = { a: deferred(), b: deferred(), c: deferred() };
    for (const lane of ["a", "b", "c"] as const) {
      scheduler.enqueue(lane, () => {
        started.push(lane);
        return gates[lane].promise;
      });
    }
    await tick();
    expect(started).toEqual(["a", "b"]);
    gates.b.resolve();
    await tick();
    expect(started).toEqual(["a", "b", "c"]);
    gates.a.resolve();
    gates.c.resolve();
    await scheduler.idle();
  });

  it("keeps one job per lane at a time, in arrival order", async () => {
    const scheduler = createLaneScheduler(2);
    const log: string[] = [];
    const first = deferred();
    scheduler.enqueue("rule", async () => {
      log.push("start 1");
      await first.promise;
      log.push("end 1");
    });
    scheduler.enqueue("rule", async () => {
      log.push("start 2");
    });
    scheduler.enqueue("other", async () => {
      log.push("other");
    });
    await tick();
    expect(log).toEqual(["start 1", "other"]);
    first.resolve();
    await scheduler.idle();
    expect(log).toEqual(["start 1", "other", "end 1", "start 2"]);
  });

  it("serialises everything when the limit is one and survives failing jobs", async () => {
    const scheduler = createLaneScheduler(1);
    const log: string[] = [];
    let running = 0;
    let peak = 0;
    for (const lane of ["a", "b", "c"]) {
      scheduler.enqueue(lane, async () => {
        running += 1;
        peak = Math.max(peak, running);
        await tick();
        running -= 1;
        log.push(lane);
        if (lane === "a") throw new Error("boom");
      });
    }
    await scheduler.idle();
    expect(log).toEqual(["a", "b", "c"]);
    expect(peak).toBe(1);
  });

  it("never runs more than the limit even with many lanes", async () => {
    const scheduler = createLaneScheduler(2);
    let running = 0;
    let peak = 0;
    for (let index = 0; index < 8; index += 1) {
      scheduler.enqueue(`lane${index}`, async () => {
        running += 1;
        peak = Math.max(peak, running);
        await tick();
        running -= 1;
      });
    }
    await scheduler.idle();
    expect(peak).toBe(2);
  });

  it("resolves idle immediately when nothing is queued", async () => {
    await expect(createLaneScheduler().idle()).resolves.toBeUndefined();
  });
});

describe("watchLane", () => {
  it("groups rules that write to the same place regardless of case and separators", () => {
    expect(watchLane({ folder: "C:\\In", outputDir: "C:\\Out\\" })).toBe(watchLane({ folder: "D:/other", outputDir: "c:/out" }));
    expect(watchLane({ folder: "C:\\In", outputDir: "" })).toBe("c:/in");
    expect(watchLane({ folder: "C:\\In", outputDir: "" })).not.toBe(watchLane({ folder: "C:\\In2", outputDir: "" }));
  });
});
