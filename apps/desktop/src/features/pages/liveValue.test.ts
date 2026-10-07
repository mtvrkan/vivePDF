import { describe, expect, it, vi } from "vitest";
import { createLiveValue } from "./liveValue";

describe("createLiveValue", () => {
  it("hands the current value to a new listener and every later change", () => {
    const live = createLiveValue<{ x: number }>();
    live.set({ x: 1 });
    const listener = vi.fn();

    live.subscribe(listener);
    live.set({ x: 2 });

    expect(listener.mock.calls).toEqual([[{ x: 1 }], [{ x: 2 }]]);
  });

  it("stops calling a listener once it unsubscribes", () => {
    const live = createLiveValue<number>();
    const listener = vi.fn();
    const stop = live.subscribe(listener);

    stop();
    live.set(5);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(live.get()).toBe(5);
  });

  it("starts empty", () => {
    expect(createLiveValue<number>().get()).toBeNull();
  });
});
