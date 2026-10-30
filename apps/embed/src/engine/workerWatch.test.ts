import { describe, expect, it, vi } from "vitest";
import { captureWorkers, watchEngineWorkers } from "./workerWatch";

class FakeWorker extends EventTarget {
  constructor(readonly url: string | URL) {
    super();
  }
}

function message(type: string): MessageEvent {
  return new MessageEvent("message", { data: { type } });
}

describe("captureWorkers", () => {
  it("collects the workers made during the call and puts the original constructor back", () => {
    const scope = { Worker: FakeWorker as unknown as typeof Worker };

    const { result, workers } = captureWorkers(() => {
      new scope.Worker("engine-worker.js");
      new scope.Worker("encoder-worker.js");
      return "engine";
    }, scope);

    expect(result).toBe("engine");
    expect(workers.map((worker) => (worker as unknown as FakeWorker).url)).toEqual(["engine-worker.js", "encoder-worker.js"]);
    expect(scope.Worker).toBe(FakeWorker);
  });

  it("puts the original constructor back when the call throws", () => {
    const scope = { Worker: FakeWorker as unknown as typeof Worker };

    expect(() => captureWorkers(() => {
      throw new Error("boom");
    }, scope)).toThrow("boom");
    expect(scope.Worker).toBe(FakeWorker);
  });
});

describe("watchEngineWorkers", () => {
  it("reports a start failure when the engine cannot load its wasm", () => {
    const worker = new FakeWorker("engine-worker.js");
    const onFailure = vi.fn();
    watchEngineWorkers([worker as unknown as Worker], onFailure);

    worker.dispatchEvent(message("wasmError"));

    expect(onFailure).toHaveBeenCalledWith("start");
  });

  it("reports a crash once when a worker fails after the engine was ready", () => {
    const engine = new FakeWorker("engine-worker.js");
    const encoder = new FakeWorker("encoder-worker.js");
    const onFailure = vi.fn();
    watchEngineWorkers([engine, encoder] as unknown as Worker[], onFailure);

    engine.dispatchEvent(message("ready"));
    encoder.dispatchEvent(new Event("error"));
    engine.dispatchEvent(new Event("error"));

    expect(onFailure.mock.calls).toEqual([["crash"]]);
  });

  it("stops listening when released", () => {
    const worker = new FakeWorker("engine-worker.js");
    const onFailure = vi.fn();
    const release = watchEngineWorkers([worker as unknown as Worker], onFailure);

    release();
    worker.dispatchEvent(message("wasmError"));

    expect(onFailure).not.toHaveBeenCalled();
  });
});
