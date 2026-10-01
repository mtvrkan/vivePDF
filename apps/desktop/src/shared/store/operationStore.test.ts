import { beforeEach, describe, expect, it } from "vitest";
import { useOperationStore } from "./operationStore";

beforeEach(() => {
  useOperationStore.setState({ running: 0, progress: null });
});

describe("operation store", () => {
  it("counts concurrent operations and clears progress only when the last one ends", () => {
    const store = useOperationStore.getState();
    store.begin();
    store.report(0.4);
    store.begin();
    expect(useOperationStore.getState()).toMatchObject({ running: 2, progress: null });
    store.report(0.7);
    store.end();
    expect(useOperationStore.getState()).toMatchObject({ running: 1, progress: 0.7 });
    store.end();
    expect(useOperationStore.getState()).toMatchObject({ running: 0, progress: null });
  });

  it("ignores progress reported while nothing is running", () => {
    useOperationStore.getState().report(0.5);
    expect(useOperationStore.getState().progress).toBeNull();
  });

  it("never counts below zero", () => {
    useOperationStore.getState().end();
    expect(useOperationStore.getState().running).toBe(0);
  });
});
