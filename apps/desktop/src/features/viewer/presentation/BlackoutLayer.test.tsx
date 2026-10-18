import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { measureLabel } from "./measure";
import { BlackoutLayer } from "./BlackoutLayer";

beforeAll(async () => {
  await ready();
  await setLocale("en");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  usePresentationStore.getState().resetSession();
  usePresentationStore.getState().resetPrefs();
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
      usePresentationStore.getState().setBoardPen("white", { penWidth: 6 });
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

  it("draws with the board's own pen instead of the slide pen", () => {
    act(() => {
      usePresentationStore.getState().setPenColor("#E5484D");
      usePresentationStore.getState().setBoardPen("black", { penColor: "#22D3EE", penWidth: 10, highlighterColor: "#4ADE80", highlighterWidth: 30 });
      usePresentationStore.getState().setBlackout("black");
      usePresentationStore.getState().setTool("pen");
    });
    render(<BlackoutLayer />);

    drag(board(), [[100, 100], [200, 200]]);
    act(() => usePresentationStore.getState().setTool("highlighter"));
    drag(board(), [[100, 300], [200, 300]]);

    const [ink, marker] = usePresentationStore.getState().boardStrokes.black;
    expect(ink).toMatchObject({ tool: "pen", color: "#22D3EE" });
    expect(ink.width * 1000).toBeCloseTo(10);
    expect(marker).toMatchObject({ tool: "highlighter", color: "#4ADE80" });
    expect(marker.width * 1000).toBeCloseTo(30);
  });

  it("undoes a whole eraser drag in one step and sizes the eraser from the board pen", () => {
    act(() => {
      usePresentationStore.getState().setBlackout("white");
      usePresentationStore.getState().setTool("pen");
    });
    render(<BlackoutLayer />);
    drag(board(), [[100, 100], [400, 100]]);
    const drawn = usePresentationStore.getState().boardStrokes.white;

    act(() => {
      usePresentationStore.getState().setBoardPen("white", { eraserSize: 12 });
      usePresentationStore.getState().setTool("eraser");
    });
    drag(board(), [[200, 100], [210, 100], [300, 100]]);
    const pieces = usePresentationStore.getState().boardStrokes.white;
    act(() => usePresentationStore.getState().undoBoard("white"));

    expect(pieces).toHaveLength(3);
    expect(pieces[1].points[0].x).toBeCloseTo(0.218);
    expect(usePresentationStore.getState().boardStrokes.white).toBe(drawn);
  });

  it("keeps an eraser drag that touched nothing out of the undo history", () => {
    act(() => {
      usePresentationStore.getState().setBlackout("black");
      usePresentationStore.getState().setTool("eraser");
    });
    render(<BlackoutLayer />);

    drag(board(), [[100, 100], [200, 100]]);

    expect(usePresentationStore.getState().boardHistory.black.undo).toEqual([]);
  });
});

describe("BlackoutLayer inside the presenter console", () => {
  it("draws relative to its own box instead of the whole window", () => {
    act(() => {
      usePresentationStore.getState().setBlackout("white");
      usePresentationStore.getState().setTool("pen");
    });
    render(<BlackoutLayer contained />);
    const target = board();
    target.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200, x: 100, y: 50, right: 500, bottom: 250, toJSON: () => null }) as DOMRect;

    drag(target, [
      [100, 50],
      [300, 150],
      [500, 250],
    ]);

    expect(target.className).toContain("absolute");
    expect(usePresentationStore.getState().boardStrokes.white[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]);
  });

  it("leaves out the shortcut hint on the audience screen", () => {
    act(() => usePresentationStore.getState().setBlackout("black"));

    render(<BlackoutLayer hint={false} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(board()).not.toBeNull();
  });

  it("labels a measure line on the board in the size of the page the board is saved as", () => {
    useDocumentStore.setState({ activeId: "d", documents: { d: { info: { pageSizes: [{ width: 200, height: 200 }, { width: 600, height: 900 }] } } } as never });
    act(() => {
      usePresentationStore.getState().setBlackout("black");
      usePresentationStore.getState().setShapeKind("measure");
      usePresentationStore.getState().setTool("shape");
    });
    render(<BlackoutLayer />);

    drag(board(), [[100, 250], [600, 250]]);

    const [line] = usePresentationStore.getState().boardStrokes.black;
    expect(line.pageSize).toEqual({ width: 600, height: 300 });
    expect(measureLabel(line, "en")).toBe("10.6 cm");
    useDocumentStore.setState({ documents: {}, activeId: null });
  });

  it("falls back to an A4-wide board when no document is open", () => {
    act(() => {
      usePresentationStore.getState().setBlackout("white");
      usePresentationStore.getState().setShapeKind("measure");
      usePresentationStore.getState().setTool("shape");
    });
    render(<BlackoutLayer />);

    drag(board(), [[0, 100], [1000, 100]]);

    expect(measureLabel(usePresentationStore.getState().boardStrokes.white[0], "en")).toBe("21 cm");
  });
});
