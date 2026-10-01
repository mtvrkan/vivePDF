import { normalizePath } from "./pathRelation";

export const WATCH_CONCURRENCY = 2;

type Job = { lane: string; run: () => Promise<void> };

export type LaneScheduler = {
  enqueue: (lane: string, run: () => Promise<void>) => void;
  idle: () => Promise<void>;
};

export function createLaneScheduler(limit: number = WATCH_CONCURRENCY): LaneScheduler {
  const capacity = Math.max(1, Math.floor(limit));
  const waiting: Job[] = [];
  const busyLanes = new Set<string>();
  let idleWaiters: Array<() => void> = [];

  const settleIdle = () => {
    if (busyLanes.size > 0 || waiting.length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  };

  const pump = () => {
    while (busyLanes.size < capacity) {
      const index = waiting.findIndex((job) => !busyLanes.has(job.lane));
      if (index < 0) break;
      const [job] = waiting.splice(index, 1);
      busyLanes.add(job.lane);
      void Promise.resolve()
        .then(job.run)
        .catch(() => undefined)
        .finally(() => {
          busyLanes.delete(job.lane);
          pump();
          settleIdle();
        });
    }
  };

  return {
    enqueue: (lane, run) => {
      waiting.push({ lane, run });
      pump();
    },
    idle: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
        settleIdle();
      }),
  };
}

export function watchLane(rule: { folder: string; outputDir: string }): string {
  return normalizePath(rule.outputDir || rule.folder);
}
