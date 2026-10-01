type Job = { start: () => void; cancelled: boolean };

export function createThumbnailQueue(limit: number, capacity: number) {
  const cache = new Map<string, string>();
  const waiting: Job[] = [];
  let running = 0;

  const pump = () => {
    while (running < limit && waiting.length > 0) {
      const job = waiting.shift() as Job;
      if (job.cancelled) continue;
      running += 1;
      job.start();
    }
  };

  const remember = (key: string, value: string) => {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > capacity) cache.delete(cache.keys().next().value as string);
  };

  const recall = (key: string): string | null => {
    const value = cache.get(key);
    if (value === undefined) return null;
    cache.delete(key);
    cache.set(key, value);
    return value;
  };

  const load = (key: string, loader: (signal: AbortSignal) => Promise<string>, onDone: (value: string | null) => void): (() => void) => {
    const cached = recall(key);
    if (cached) {
      onDone(cached);
      return () => undefined;
    }
    const controller = new AbortController();
    const job: Job = {
      cancelled: false,
      start: () => {
        loader(controller.signal)
          .then((value) => {
            remember(key, value);
            if (!job.cancelled) onDone(value);
          })
          .catch(() => {
            if (!job.cancelled) onDone(null);
          })
          .finally(() => {
            running -= 1;
            pump();
          });
      },
    };
    waiting.push(job);
    pump();
    return () => {
      job.cancelled = true;
      const index = waiting.indexOf(job);
      if (index >= 0) waiting.splice(index, 1);
      controller.abort();
    };
  };

  return { load, recall, size: () => cache.size, pending: () => waiting.length };
}
