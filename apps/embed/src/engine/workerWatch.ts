export type EngineFailure = "start" | "crash";

type WorkerScope = { Worker: typeof Worker };

export function captureWorkers<T>(create: () => T, scope: WorkerScope = globalThis): { result: T; workers: Worker[] } {
  const Native = scope.Worker;
  const workers: Worker[] = [];
  scope.Worker = class extends Native {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      workers.push(this);
    }
  };
  try {
    return { result: create(), workers };
  } finally {
    scope.Worker = Native;
  }
}

export function watchEngineWorkers(workers: Worker[], onFailure: (failure: EngineFailure) => void): () => void {
  let ready = false;
  let failed = false;
  const fail = (failure: EngineFailure) => {
    if (failed) return;
    failed = true;
    onFailure(failure);
  };
  const onMessage = (event: MessageEvent) => {
    const type = (event.data as { type?: unknown } | null)?.type;
    if (type === "ready") ready = true;
    else if (type === "wasmError") fail("start");
  };
  const onError = () => fail(ready ? "crash" : "start");
  for (const worker of workers) {
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  }
  return () => {
    for (const worker of workers) {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    }
  };
}
