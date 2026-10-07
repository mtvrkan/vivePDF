import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { BlackoutLayer } from "./BlackoutLayer";

beforeAll(async () => {
  await ready();
  await setLocale("en");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  usePresentationStore.getState().resetSession();
  Object.assign(window, { innerWidth: 1000, innerHeight: 500 });
});

afterEach(cleanup);

function board() {
  return document.querySelector<HTMLElement>("[data-presentation-board]") as HTMLElement;
}

function drag(target: HTMLElement, points: Array<[number, number]>) {
  const [first, ...rest] = points;
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: first[0], clientY: first[1] });
  for (const [x, y] of rest) fireEvent.pointerMove(target, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(target, { pointerId: 1 });
}

describe("BlackoutLayer", () => {
  it("shows nothing until the screen is blacked out", () => {
    const { container } = render(<BlackoutLayer />);
    expect(container.innerHTML).toBe("");
  });

  it("tells how to leave and draw, then fades the hint", () => {
    vi.useFakeTimers();
    try {
      act(() => usePresentationStore.getState().setBlackout("black"));
      render(<BlackoutLayer />);
      const hint = screen.getByRole("status");
      expect(hint.textContent).toBe("Esc returns to the slides · P pen · H highlighter · E eraser");
      expect(hint.className).toContain("opacity-100");
      act(() => vi.advanceTimersByTime(4000));
      expect(hint.className).toContain("opacity-0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws on the board with the pen and keeps each board apart", () => {
    act(() => {
      usePresentationStore.getState().setBlackout("white");
      usePresentationStore.getState().setTool("pen");
    });
    render(<BlackoutLayer />);
    drag(board(), [
      [100, 100],
      [200, 150],
      [300, 250],
    ]);
    const strokes = usePresentationStore.getState().boardStrokes;
    expect(strokes.white).toHaveLength(1);
    expect(strokes.white[0].points).toEqual([
      { x: 0.1, y: 0.2 },
      { x: 0.2, y: 0.3 },
      { x: 0.3, y: 0.5 },
    ]);
    expect(strokes.black).toEqual([]);
    expect(usePresentationStore.getState().strokesByPage).toEqual({});
  });

  it("draws a held-Shift square on the board at the picked pixel width", () => {
    act(() => {
      usePresentationStore.getState().setBlackout("white");
      usePresentationStore.getState().setShapeKind("rect");
      usePresentationStore.getState().setPenWidth(6);
      usePresentationStore.getState().setTool("shape");
    });
    render(<BlackoutLayer />);
    const target = board();
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 300, clientY: 150, shiftKey: true });
    fireEvent.pointerUp(target, { pointerId: 1 });

    const [square] = usePresentationStore.getState().boardStrokes.white;
    expect(square.tool).toBe("rect");
    expect(square.width * 1000).toBeCloseTo(6);
    expect(square.points[1].x * 1000 - 100).toBeCloseTo(square.points[1].y * 500 - 100);
  });

  it("erases board strokes and ignores the pointer tool", () => {
    act(() => {
      usePresentationStore.getState().setBlackout("black");
      usePresentationStore.getState().setTool("pen");
    });
    render(<BlackoutLayer />);
    drag(board(), [
      [100, 100],
      [400, 100],
    ]);
    act(() => usePresentationStore.getState().setTool("pointer"));
    drag(board(), [
      [100, 300],
      [400, 300],
    ]);
    expect(usePresentationStore.getState().boardStrokes.black).toHaveLength(1);

    act(() => usePresentationStore.getState().setTool("eraser"));
    drag(board(), [
      [250, 100],
      [260, 100],
    ]);
    const pieces = usePresentationStore.getState().boardStrokes.black;
    expect(pieces).toHaveLength(2);
    expect(pieces[0].points[0]).toEqual({ x: 0.1, y: 0.2 });
    expect(pieces[1].points.at(-1)).toEqual({ x: 0.4, y: 0.2 });
    expect(pieces.every((piece) => piece.points.every((point) => Math.abs(point.x - 0.255) > 0.015))).toBe(true);
  });
});
