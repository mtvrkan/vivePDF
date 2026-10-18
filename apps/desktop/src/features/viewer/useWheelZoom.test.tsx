import { useRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PINCH_HOLD_MS, useWheelZoom } from "./useWheelZoom";

const { requestZoom } = vi.hoisted(() => ({ requestZoom: vi.fn() }));

vi.mock("@embedpdf/plugin-zoom/react", () => ({
  useZoom: () => ({ provides: { getState: () => ({ currentZoomLevel: 1 }), requestZoom } }),
}));

function Pane() {
  const ref = useRef<HTMLDivElement>(null);
  useWheelZoom(ref, "doc");
  return (
    <div ref={ref} data-testid="host">
      <div data-pan-scroller data-testid="scroller" />
    </div>
  );
}

function wheel(target: Element, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  requestZoom.mockReset();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useWheelZoom", () => {
  it("leaves plain scrolling to the browser without a blocking wheel listener", () => {
    const added = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const { getByTestId } = render(<Pane />);

    const event = wheel(getByTestId("scroller"), {});
    vi.runAllTimers();

    expect(event.defaultPrevented).toBe(false);
    expect(requestZoom).not.toHaveBeenCalled();
    expect(added.mock.calls.filter(([type, , options]) => type === "wheel" && typeof options === "object" && options.passive === false)).toHaveLength(0);
    added.mockRestore();
  });

  it("zooms and keeps the page from zooming while Ctrl is held", () => {
    const { getByTestId } = render(<Pane />);
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });

    const event = wheel(getByTestId("scroller"), { ctrlKey: true });
    vi.runAllTimers();

    expect(event.defaultPrevented).toBe(true);
    expect(requestZoom).toHaveBeenCalledTimes(1);
    expect(requestZoom.mock.calls[0][0]).toBeGreaterThan(1);
  });

  it("blocks a trackpad pinch after its first event and lets scrolling go again once it ends", () => {
    const { getByTestId } = render(<Pane />);
    const scroller = getByTestId("scroller");

    const first = wheel(scroller, { ctrlKey: true });
    const second = wheel(scroller, { ctrlKey: true });
    vi.advanceTimersByTime(PINCH_HOLD_MS + 10);
    const afterwards = wheel(scroller, { ctrlKey: false });

    expect(first.defaultPrevented).toBe(false);
    expect(second.defaultPrevented).toBe(true);
    expect(afterwards.defaultPrevented).toBe(false);
    expect(requestZoom).toHaveBeenCalled();
  });

  it("stops blocking when Ctrl is released or the window loses focus", () => {
    const { getByTestId } = render(<Pane />);
    const scroller = getByTestId("scroller");
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    fireEvent.keyUp(window, { key: "Control", ctrlKey: false });

    const released = wheel(scroller, { ctrlKey: true });
    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    fireEvent.blur(window);
    vi.advanceTimersByTime(PINCH_HOLD_MS + 10);
    const blurred = wheel(scroller, { metaKey: true });

    expect(released.defaultPrevented).toBe(false);
    expect(blurred.defaultPrevented).toBe(false);
  });
});
