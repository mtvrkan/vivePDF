import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import { BlackoutLayer } from "./BlackoutLayer";
import { useBoardLiveStore } from "./boardLiveStore";

const painted: string[] = [];
const REMOTE: Stroke = { id: "remote", tool: "pen", color: "#ffffff", width: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] };

function recordingContext() {
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, name) => (name in target ? target[name] : (target[name] = (...args: unknown[]) => painted.push(`${String(name)}:${args.length}`))),
  });
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => recordingContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

beforeEach(() => {
  usePresentationStore.getState().resetSession();
  useBoardLiveStore.getState().publish(null);
  painted.length = 0;
  Object.assign(window, { innerWidth: 1000, innerHeight: 500 });
});

afterEach(cleanup);

function board() {
  return document.querySelector<HTMLElement>("[data-presentation-board]") as HTMLElement;
}

function strokesPainted() {
  return painted.filter((call) => call.startsWith("stroke:") || call.startsWith("fill:")).length;
}

describe("BlackoutLayer live strokes", () => {
  it("publishes the stroke while the pen is down and withdraws it when the pen lifts", () => {
    act(() => {
      usePresentationStore.getState().setBlackout("white");
      usePresentationStore.getState().setTool("pen");
    });
    render(<BlackoutLayer />);

    fireEvent.pointerDown(board(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: 300, clientY: 200 });
    const during = useBoardLiveStore.getState().live;
    fireEvent.pointerUp(board(), { pointerId: 1 });

    expect(during?.board).toBe("white");
    expect(during?.stroke.points.length).toBeGreaterThan(1);
    expect(useBoardLiveStore.getState().live).toBeNull();
  });

  it("draws the presenter's live stroke on the matching board only", () => {
    act(() => usePresentationStore.getState().setBlackout("black"));
    const { rerender } = render(<BlackoutLayer contained hint={false} remote={null} />);
    const empty = strokesPainted();

    rerender(<BlackoutLayer contained hint={false} remote={{ board: "white", stroke: REMOTE }} />);
    const otherBoard = strokesPainted();
    rerender(<BlackoutLayer contained hint={false} remote={{ board: "black", stroke: REMOTE }} />);

    expect(otherBoard).toBe(empty);
    expect(strokesPainted()).toBeGreaterThan(otherBoard);
  });

  it("withdraws a live stroke when the board closes mid-stroke", () => {
    act(() => {
      usePresentationStore.getState().setBlackout("black");
      usePresentationStore.getState().setTool("pen");
    });
    const { unmount } = render(<BlackoutLayer />);
    fireEvent.pointerDown(board(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: 300, clientY: 200 });

    unmount();

    expect(useBoardLiveStore.getState().live).toBeNull();
  });
});
