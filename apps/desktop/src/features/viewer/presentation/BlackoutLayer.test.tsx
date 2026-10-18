import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { DEFAULT_BOARD_PENS, usePresentationStore, type PresentationTool } from "@/shared/store/presentationStore";
import { axeViolations } from "@/test/axe";
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
      expect(hint.textContent).toBe("Esc returns to the slides · P pen · H highlighter · E eraser · V select");
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

function openBoard(mode: "black" | "white", tool: PresentationTool, controls = true) {
  act(() => {
    usePresentationStore.getState().setBlackout(mode);
    usePresentationStore.getState().setTool(tool);
  });
  return render(<BlackoutLayer controls={controls} />);
}

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key === "[" ? "BracketLeft" : key === "]" ? "BracketRight" : key;
  act(() => {
    fireEvent.keyDown(window, { key, code, ...init });
  });
}

function boardIds(mode: "black" | "white") {
  return usePresentationStore.getState().boardStrokes[mode].map((stroke) => stroke.id);
}

function drawTwoLines() {
  drag(board(), [
    [100, 100],
    [300, 100],
  ]);
  drag(board(), [
    [100, 300],
    [300, 300],
  ]);
}

function selectionStatus() {
  return screen.getByTestId("board-selection-status").textContent;
}

describe("board pen options", () => {
  it("offers colours that suit each board and remembers the pick per board", () => {
    openBoard("black", "pen");
    expect(screen.getByRole("button", { name: "White" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Cyan" }));
    drag(board(), [
      [100, 100],
      [200, 200],
    ]);

    const state = usePresentationStore.getState();
    expect(state.boardPens.black.penColor).toBe("#22D3EE");
    expect(state.boardPens.white.penColor).toBe(DEFAULT_BOARD_PENS.white.penColor);
    expect(state.boardStrokes.black[0].color).toBe("#22D3EE");
    expect(state.boardStrokes.black[0].width * 1000).toBeCloseTo(DEFAULT_BOARD_PENS.black.penWidth);
    cleanup();

    openBoard("white", "pen");
    expect(screen.queryByRole("button", { name: "Cyan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Blue" })).toBeTruthy();
  });

  it("sets the thickness from presets, the slider and the bracket keys", () => {
    openBoard("white", "pen");

    fireEvent.click(screen.getByRole("button", { name: "Thickness" }));
    fireEvent.click(screen.getByRole("button", { name: "Size 16" }));
    expect(usePresentationStore.getState().boardPens.white.penWidth).toBe(16);
    fireEvent.change(screen.getByRole("slider", { name: "Thickness" }), { target: { value: "20" } });
    expect(usePresentationStore.getState().boardPens.white.penWidth).toBe(20);
    press("[");
    expect(usePresentationStore.getState().boardPens.white.penWidth).toBe(16);
    press("]");
    expect(usePresentationStore.getState().boardPens.white.penWidth).toBe(16);
    expect(usePresentationStore.getState().boardPens.black.penWidth).toBe(DEFAULT_BOARD_PENS.black.penWidth);
  });

  it("sizes the eraser and the highlighter colour separately from the pen", () => {
    openBoard("black", "highlighter");
    fireEvent.click(screen.getByRole("button", { name: "Pink" }));
    act(() => usePresentationStore.getState().setTool("eraser"));
    fireEvent.click(screen.getByRole("button", { name: "Eraser size" }));
    fireEvent.click(screen.getByRole("button", { name: "Size 96" }));

    expect(usePresentationStore.getState().boardPens.black).toMatchObject({ highlighterColor: "#F472B6", penColor: DEFAULT_BOARD_PENS.black.penColor, eraserSize: 96 });
  });

  it("styles shapes with the board pen", () => {
    openBoard("white", "shape");

    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    drag(board(), [
      [100, 100],
      [300, 200],
    ]);

    expect(usePresentationStore.getState().boardStrokes.white[0].color).toBe("#DC2626");
  });

  it("has no axe violations with the size panel open", async () => {
    openBoard("black", "pen");
    fireEvent.click(screen.getByRole("button", { name: "Thickness" }));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("board selection", () => {
  it("selects with a dragged rectangle and deletes in one undoable step", () => {
    openBoard("white", "pen");
    drawTwoLines();
    const [first, second] = boardIds("white");

    act(() => usePresentationStore.getState().setTool("select"));
    drag(board(), [
      [50, 50],
      [350, 150],
    ]);
    expect(selectionStatus()).toBe("1 drawing selected");
    expect(usePresentationStore.getState().selectedDrawing).toEqual({ surface: "white", id: first });

    press("Delete");
    expect(boardIds("white")).toEqual([second]);
    press("z", { ctrlKey: true });
    expect(boardIds("white")).toEqual([first, second]);
    press("y", { ctrlKey: true });
    expect(boardIds("white")).toEqual([second]);
  });

  it("adds drawings with Shift+click, drags them together and nudges them with the arrows", () => {
    openBoard("black", "pen");
    drawTwoLines();
    act(() => usePresentationStore.getState().setTool("select"));

    drag(board(), [[200, 100]]);
    expect(selectionStatus()).toBe("1 drawing selected");
    fireEvent.pointerDown(board(), { button: 0, pointerId: 1, clientX: 200, clientY: 300, shiftKey: true });
    fireEvent.pointerUp(board(), { pointerId: 1 });
    expect(selectionStatus()).toBe("2 drawings selected");
    expect(usePresentationStore.getState().selectedDrawing).toBeNull();
    expect(document.querySelector('[data-board-outline="selection"]')).not.toBeNull();

    drag(board(), [
      [200, 100],
      [250, 150],
    ]);
    const moved = usePresentationStore.getState().boardStrokes.black;
    expect(moved[0].points[0].x).toBeCloseTo(0.15);
    expect(moved[0].points[0].y).toBeCloseTo(0.3);
    expect(moved[1].points[0].y).toBeCloseTo(0.7);

    press("ArrowRight");
    expect(usePresentationStore.getState().boardStrokes.black[1].points[0].x).toBeCloseTo(0.16);
    press("z", { ctrlKey: true });
    press("z", { ctrlKey: true });
    expect(usePresentationStore.getState().boardStrokes.black[1].points[0]).toEqual({ x: 0.1, y: 0.6 });
  });

  it("selects every drawing with Ctrl+A and Backspace deletes them", () => {
    openBoard("white", "pen");
    drawTwoLines();

    press("a", { ctrlKey: true });
    expect(usePresentationStore.getState().tool).toBe("select");
    expect(selectionStatus()).toBe("2 drawings selected");
    press("Backspace");

    expect(boardIds("white")).toEqual([]);
  });

  it("keeps board undo from reaching the slide shortcuts", () => {
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      usePresentationStore.getState().addStroke(0, { id: "slide", tool: "pen", color: "#000000", width: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] });
      openBoard("black", "pen");
      drawTwoLines();

      press("z", { ctrlKey: true });

      expect(outer).not.toHaveBeenCalled();
      expect(boardIds("black")).toHaveLength(1);
      expect(usePresentationStore.getState().strokesByPage[0]).toHaveLength(1);
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("asks before clearing the board and lets Ctrl+Z bring it back", async () => {
    openBoard("black", "pen");
    drawTwoLines();

    fireEvent.click(screen.getByRole("button", { name: "Clear board" }));
    const dialog = screen.getByRole("alertdialog", { name: "Clear this board?" });
    expect(dialog.textContent).toContain("2 drawings on this board will be removed.");
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(boardIds("black")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Clear board" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Clear board" }));
    expect(boardIds("black")).toEqual([]);
    press("z", { ctrlKey: true });
    expect(boardIds("black")).toHaveLength(2);
  });

  it("returns to the slides from the toolbar", () => {
    openBoard("white", "select");

    fireEvent.click(screen.getByRole("button", { name: "Back to slides" }));

    expect(usePresentationStore.getState().blackout).toBe("none");
  });

  it("shows no toolbar and takes no board keys on the audience screen", () => {
    usePresentationStore.getState().addBoardStroke("white", { id: "a", tool: "pen", color: "#000000", width: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] });
    openBoard("white", "pen", false);

    press("z", { ctrlKey: true });

    expect(document.querySelector("[data-board-toolbar]")).toBeNull();
    expect(screen.queryByTestId("board-selection-status")).toBeNull();
    expect(boardIds("white")).toEqual(["a"]);
  });

  it("leaves Escape and keys typed while a dialog is open to the dialog", () => {
    openBoard("black", "pen");
    drawTwoLines();
    fireEvent.click(screen.getByRole("button", { name: "Clear board" }));

    press("z", { ctrlKey: true });

    expect(boardIds("black")).toHaveLength(2);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
