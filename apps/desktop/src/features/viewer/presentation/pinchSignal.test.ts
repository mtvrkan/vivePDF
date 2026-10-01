import { describe, expect, it, vi } from "vitest";
import { watchPinch } from "./pinchSignal";

function fire(target: EventTarget, type: string, fields: Record<string, unknown> = {}) {
  target.dispatchEvent(Object.assign(new Event(type), fields));
}

describe("watchPinch", () => {
  it("reports a two-finger touch as a pinch but not a single finger", () => {
    const target = new EventTarget();
    const onPinch = vi.fn();
    watchPinch(target, onPinch);
    fire(target, "touchstart", { touches: { length: 1 } });
    expect(onPinch).not.toHaveBeenCalled();
    fire(target, "touchmove", { touches: { length: 2 } });
    expect(onPinch).toHaveBeenCalledTimes(1);
  });

  it("reports WebKit trackpad gestures", () => {
    const target = new EventTarget();
    const onPinch = vi.fn();
    watchPinch(target, onPinch);
    fire(target, "gesturestart");
    fire(target, "gesturechange");
    expect(onPinch).toHaveBeenCalledTimes(2);
  });

  it("counts touch pointers and forgets lifted fingers", () => {
    const target = new EventTarget();
    const onPinch = vi.fn();
    watchPinch(target, onPinch);
    fire(target, "pointerdown", { pointerId: 1, pointerType: "touch" });
    fire(target, "pointerup", { pointerId: 1, pointerType: "touch" });
    fire(target, "pointerdown", { pointerId: 2, pointerType: "touch" });
    fire(target, "pointerdown", { pointerId: 3, pointerType: "mouse" });
    expect(onPinch).not.toHaveBeenCalled();
    fire(target, "pointerdown", { pointerId: 4, pointerType: "touch" });
    expect(onPinch).toHaveBeenCalledTimes(1);
  });

  it("stops listening once disposed", () => {
    const target = new EventTarget();
    const onPinch = vi.fn();
    const dispose = watchPinch(target, onPinch);
    dispose();
    fire(target, "gesturestart");
    expect(onPinch).not.toHaveBeenCalled();
  });
});
