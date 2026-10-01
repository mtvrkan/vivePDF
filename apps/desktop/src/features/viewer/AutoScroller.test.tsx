import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoScrollStore } from "@/shared/store/autoScrollStore";
import { AutoScroller } from "./AutoScroller";

let frames: FrameRequestCallback[] = [];

function runFrame(now: number) {
  const pending = frames;
  frames = [];
  pending.forEach((callback) => callback(now));
}

function Host({ size = 5000 }: { size?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={hostRef}>
      <div
        data-pan-scroller
        ref={(node) => {
          if (!node) return;
          Object.defineProperty(node, "scrollHeight", { configurable: true, value: size });
          Object.defineProperty(node, "clientHeight", { configurable: true, value: 500 });
        }}
      />
      <AutoScroller documentId="doc" hostRef={hostRef} />
    </div>
  );
}

function scroller(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-pan-scroller]") as HTMLElement;
}

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  useAutoScrollStore.setState({ running: false, speedIndex: 2, backwards: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AutoScroller", () => {
  it("moves the pages down at the chosen speed while running", () => {
    const { container } = render(<Host />);

    act(() => useAutoScrollStore.getState().start());
    runFrame(0);
    runFrame(200);

    expect(scroller(container).scrollTop).toBe(10);
  });

  it("does not move again once stopped, even before the effect is cleaned up", () => {
    const { container } = render(<Host />);
    act(() => useAutoScrollStore.getState().start());
    runFrame(0);
    runFrame(200);

    useAutoScrollStore.getState().stop();
    runFrame(400);

    expect(scroller(container).scrollTop).toBe(10);
  });

  it("stops by itself at the end of the document", () => {
    const { container } = render(<Host size={500} />);

    act(() => useAutoScrollStore.getState().start());
    runFrame(0);
    act(() => runFrame(200));

    expect(scroller(container).scrollTop).toBe(0);
    expect(useAutoScrollStore.getState().running).toBe(false);
  });
});
