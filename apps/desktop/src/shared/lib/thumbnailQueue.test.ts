import { describe, expect, it } from "vitest";
import { createThumbnailQueue } from "./thumbnailQueue";

function deferred() {
  let resolve: (value: string) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<string>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createThumbnailQueue", () => {
  it("runs at most the limit at once and starts the next when one finishes", async () => {
    const queue = createThumbnailQueue(2, 10);
    const jobs = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const done: (string | null)[] = [];
    jobs.forEach((job, index) =>
      queue.load(
        `k${index}`,
        () => {
          started.push(index);
          return job.promise;
        },
        (value) => done.push(value),
      ),
    );
    expect(started).toEqual([0, 1]);
    jobs[0].resolve("a");
    await flush();
    expect(started).toEqual([0, 1, 2]);
    expect(done).toEqual(["a"]);
  });

  it("answers from the cache and drops the oldest entry past capacity", async () => {
    const queue = createThumbnailQueue(1, 1);
    const seen: (string | null)[] = [];
    queue.load("a", async () => "one", (value) => seen.push(value));
    await flush();
    queue.load("a", async () => "never", (value) => seen.push(value));
    expect(seen).toEqual(["one", "one"]);
    queue.load("b", async () => "two", () => undefined);
    await flush();
    expect(queue.recall("a")).toBeNull();
    expect(queue.recall("b")).toBe("two");
  });

  it("skips a cancelled waiting job, aborts a running one and reports failures as null", async () => {
    const queue = createThumbnailQueue(1, 5);
    const first = deferred();
    let aborted = false;
    const results: (string | null)[] = [];
    const cancelFirst = queue.load(
      "first",
      (signal) => {
        signal.addEventListener("abort", () => (aborted = true));
        return first.promise;
      },
      (value) => results.push(value),
    );
    let secondStarted = false;
    const cancelSecond = queue.load(
      "second",
      async () => {
        secondStarted = true;
        return "x";
      },
      () => undefined,
    );
    cancelSecond();
    expect(queue.pending()).toBe(0);
    cancelFirst();
    expect(aborted).toBe(true);
    first.reject(new Error("cancelled"));
    await flush();
    expect(secondStarted).toBe(false);
    expect(results).toEqual([]);
    queue.load("third", async () => Promise.reject(new Error("bad")), (value) => results.push(value));
    await flush();
    expect(results).toEqual([null]);
  });
});
