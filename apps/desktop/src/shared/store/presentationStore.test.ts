import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "./documentStore";
import { DEFAULT_BOARD_PENS, eraseFromStroke, eraseFromStrokes, readBoardPens, readPrefs, usePresentationStore, type Stroke } from "./presentationStore";

function line(id: string, points: Array<[number, number]>, width = 0): Stroke {
  return { id, tool: "pen", color: "#000000", width, points: points.map(([x, y]) => ({ x, y })) };
}

beforeEach(() => {
  usePresentationStore.getState().resetSession();
});

describe("eraseFromStroke", () => {
  it("cuts the touched part out of the middle and keeps both ends", () => {
    const stroke = line("s", [
      [0.1, 0.5],
      [0.9, 0.5],
    ]);

    const pieces = eraseFromStroke(stroke, { x: 0.5, y: 0.5 }, 0.05);

    expect(pieces).toHaveLength(2);
    expect(pieces?.[0].points[0]).toEqual({ x: 0.1, y: 0.5 });
    expect(pieces?.[0].points[1].x).toBeCloseTo(0.45);
    expect(pieces?.[1].points[0].x).toBeCloseTo(0.55);
    expect(pieces?.[1].points[1]).toEqual({ x: 0.9, y: 0.5 });
    expect(pieces?.map((piece) => piece.id)).toEqual(["s~0", "s~1"]);
  });

  it("trims only the end it touches and keeps the stroke's look", () => {
    const stroke = { ...line("s", [[0.1, 0.5], [0.5, 0.5], [0.5, 0.9]], 0.01), color: "#ff0000" };

    const pieces = eraseFromStroke(stroke, { x: 0.5, y: 0.9 }, 0.095);

    expect(pieces).toHaveLength(1);
    expect(pieces?.[0].points[0]).toEqual({ x: 0.1, y: 0.5 });
    expect(pieces?.[0].points.at(-1)?.y).toBeCloseTo(0.8);
    expect(pieces?.[0]).toMatchObject({ color: "#ff0000", width: 0.01, tool: "pen" });
  });

  it("removes a dot or a stroke fully inside the eraser and leaves untouched strokes alone", () => {
    const dot = line("dot", [[0.5, 0.5]]);
    const short = line("short", [
      [0.49, 0.5],
      [0.51, 0.5],
    ]);
    const far = line("far", [
      [0.1, 0.1],
      [0.2, 0.1],
    ]);

    expect(eraseFromStroke(dot, { x: 0.5, y: 0.5 }, 0.02)).toEqual([]);
    expect(eraseFromStroke(short, { x: 0.5, y: 0.5 }, 0.05)).toEqual([]);
    expect(eraseFromStroke(far, { x: 0.5, y: 0.5 }, 0.05)).toBeNull();
    const strokes = [far];
    expect(eraseFromStrokes(strokes, { x: 0.5, y: 0.5 }, 0.05)).toBe(strokes);
  });
});

describe("presentation drawing cleanup", () => {
  it("clears the current page, or the board while the screen is blacked out", () => {
    const store = usePresentationStore.getState();
    store.addStroke(0, line("a", [[0.1, 0.1], [0.2, 0.2]]));
    store.addStroke(1, line("b", [[0.1, 0.1], [0.2, 0.2]]));
    store.addBoardStroke("black", line("c", [[0.1, 0.1], [0.2, 0.2]]));
    expect(usePresentationStore.getState().totalStrokeCount()).toBe(3);

    usePresentationStore.getState().clearVisible(0);
    usePresentationStore.getState().setBlackout("black");
    expect(usePresentationStore.getState().visibleStrokeCount(1)).toBe(1);
    usePresentationStore.getState().clearVisible(1);

    const state = usePresentationStore.getState();
    expect(state.strokesByPage[0]).toEqual([]);
    expect(state.strokesByPage[1]).toHaveLength(1);
    expect(state.boardStrokes.black).toEqual([]);
  });

  it("clears every page and both boards at once", () => {
    const store = usePresentationStore.getState();
    store.addStroke(2, line("a", [[0.1, 0.1], [0.2, 0.2]]));
    store.addBoardStroke("white", line("b", [[0.1, 0.1], [0.2, 0.2]]));

    usePresentationStore.getState().clearAllDrawings();

    expect(usePresentationStore.getState().totalStrokeCount()).toBe(0);
  });

  it("brings cleared drawings back without dropping ones drawn since", () => {
    const store = usePresentationStore.getState();
    store.addStroke(0, line("a", [[0.1, 0.1], [0.2, 0.2]]));
    store.addBoardStroke("white", line("b", [[0.1, 0.1], [0.2, 0.2]]));
    const { strokesByPage, boardStrokes } = usePresentationStore.getState();
    usePresentationStore.getState().clearAllDrawings();
    usePresentationStore.getState().addStroke(0, line("new", [[0.3, 0.3], [0.4, 0.4]]));

    usePresentationStore.getState().restoreDrawings({ strokesByPage, boardStrokes });

    const state = usePresentationStore.getState();
    expect(state.strokesByPage[0].map((stroke) => stroke.id)).toEqual(["a", "new"]);
    expect(state.boardStrokes.white.map((stroke) => stroke.id)).toEqual(["b"]);
  });
});

describe("drawn shapes and text", () => {
  const box: Stroke = { id: "box", tool: "rect", color: "#000000", width: 0.004, points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }] };

  it("erases a shape or a text as a whole when the eraser touches it", () => {
    const label: Stroke = { id: "label", tool: "text", color: "#000000", width: 0, points: [{ x: 0.6, y: 0.6 }], text: "Hi", fontSize: 0.02, size: { width: 0.05, height: 0.03 } };

    expect(eraseFromStroke(box, { x: 0.4, y: 0.3 }, 0.01)).toEqual([]);
    expect(eraseFromStroke(box, { x: 0.3, y: 0.3 }, 0.01)).toBeNull();
    expect(eraseFromStroke(label, { x: 0.62, y: 0.61 }, 0.01)).toEqual([]);
  });

  it("moves and removes one drawing on a page or a board and forgets its selection", () => {
    const store = usePresentationStore.getState();
    store.addStroke(1, box);
    store.addBoardStroke("black", { ...box, id: "board-box" });
    store.setTool("select");
    store.selectDrawing({ surface: 1, id: "box" });

    usePresentationStore.getState().replaceDrawing(1, { ...box, points: [{ x: 0.3, y: 0.3 }, { x: 0.5, y: 0.5 }] });
    usePresentationStore.getState().removeDrawing("black", "board-box");

    let state = usePresentationStore.getState();
    expect(state.strokesByPage[1][0].points[0]).toEqual({ x: 0.3, y: 0.3 });
    expect(state.boardStrokes.black).toEqual([]);
    expect(state.selectedDrawing).toEqual({ surface: 1, id: "box" });

    usePresentationStore.getState().removeDrawing(1, "box");
    state = usePresentationStore.getState();
    expect(state.strokesByPage[1]).toEqual([]);
    expect(state.selectedDrawing).toBeNull();
  });

  it("drops the selection when another tool is picked", () => {
    usePresentationStore.getState().setTool("select");
    usePresentationStore.getState().selectDrawing({ surface: 0, id: "box" });

    usePresentationStore.getState().setTool("pen");

    expect(usePresentationStore.getState().selectedDrawing).toBeNull();
  });

  it("keeps widths, opacity and text size inside their ranges", () => {
    const store = usePresentationStore.getState();

    store.setPenWidth(99);
    store.setHighlighterWidth(1);
    store.setPenOpacity(0);
    store.setTextSize(500);

    const state = usePresentationStore.getState();
    expect([state.penWidth, state.highlighterWidth, state.penOpacity, state.textSize]).toEqual([24, 4, 0.1, 96]);
  });
});

describe("document scope", () => {
  it("drops drawings and cached code blocks when the active document changes", () => {
    useDocumentStore.setState({ activeId: "a" });
    const store = usePresentationStore.getState();
    store.addStroke(2, line("s", [[0.1, 0.1], [0.2, 0.2]]));
    store.setCodeBlocksForPage(2, { width: 1, height: 1, blocks: [] });
    store.selectDrawing({ surface: 2, id: "s" });

    useDocumentStore.setState({ activeId: "b" });

    const state = usePresentationStore.getState();
    expect(state.strokesByPage).toEqual({});
    expect(state.codeBlocksByPage).toEqual({});
    expect(state.selectedDrawing).toBeNull();
  });

  it("keeps drawings while the same document stays active", () => {
    useDocumentStore.setState({ activeId: "a" });
    usePresentationStore.getState().addStroke(0, line("s", [[0.1, 0.1], [0.2, 0.2]]));

    useDocumentStore.setState({ activeId: "a", order: [] });

    expect(usePresentationStore.getState().strokesByPage[0]).toHaveLength(1);
  });
});

describe("board history", () => {
  const ids = (board: "black" | "white") => usePresentationStore.getState().boardStrokes[board].map((stroke) => stroke.id);

  it("undoes and redoes board strokes one change at a time and keeps each board apart", () => {
    const store = usePresentationStore.getState();
    store.addBoardStroke("black", line("a", [[0.1, 0.1], [0.2, 0.2]]));
    store.addBoardStroke("black", line("b", [[0.3, 0.3], [0.4, 0.4]]));
    store.addBoardStroke("white", line("w", [[0.1, 0.1], [0.2, 0.2]]));

    usePresentationStore.getState().undoBoard("black");
    expect(ids("black")).toEqual(["a"]);
    expect(ids("white")).toEqual(["w"]);
    usePresentationStore.getState().redoBoard("black");
    expect(ids("black")).toEqual(["a", "b"]);
    usePresentationStore.getState().undoBoard("black");
    usePresentationStore.getState().undoBoard("black");
    usePresentationStore.getState().undoBoard("black");
    expect(ids("black")).toEqual([]);
    expect(usePresentationStore.getState().boardHistory.black.redo).toHaveLength(2);
  });

  it("drops the redo branch on a new change and records a whole erase gesture as one step", () => {
    const store = usePresentationStore.getState();
    store.addBoardStroke("white", line("a", [[0.1, 0.5], [0.9, 0.5]]));
    usePresentationStore.getState().undoBoard("white");
    usePresentationStore.getState().addBoardStroke("white", line("b", [[0.1, 0.2], [0.9, 0.2]]));
    expect(usePresentationStore.getState().boardHistory.white.redo).toEqual([]);

    const before = usePresentationStore.getState().boardStrokes.white;
    usePresentationStore.getState().eraseBoardAt("white", { x: 0.3, y: 0.2 }, 0.02);
    usePresentationStore.getState().eraseBoardAt("white", { x: 0.6, y: 0.2 }, 0.02);
    usePresentationStore.getState().recordBoardHistory("white", before);
    expect(ids("white")).toHaveLength(3);

    usePresentationStore.getState().undoBoard("white");
    expect(ids("white")).toEqual(["b"]);
  });

  it("ignores an erase gesture that changed nothing and makes clearing a board undoable", () => {
    usePresentationStore.getState().addBoardStroke("black", line("a", [[0.1, 0.1], [0.2, 0.2]]));
    const undoDepth = usePresentationStore.getState().boardHistory.black.undo.length;
    usePresentationStore.getState().recordBoardHistory("black", usePresentationStore.getState().boardStrokes.black);
    expect(usePresentationStore.getState().boardHistory.black.undo).toHaveLength(undoDepth);

    usePresentationStore.getState().clearBoard("black");
    expect(ids("black")).toEqual([]);
    usePresentationStore.getState().undoBoard("black");
    expect(ids("black")).toEqual(["a"]);
  });

  it("keeps at most a hundred undo steps", () => {
    for (let i = 0; i < 120; i += 1) usePresentationStore.getState().addBoardStroke("white", line(`s${i}`, [[0.1, 0.1], [0.2, 0.2]]));

    expect(usePresentationStore.getState().boardHistory.white.undo).toHaveLength(100);
  });

  it("folds one drag of a board item into a single step and starts a new one after a seal", () => {
    usePresentationStore.getState().addBoardStroke("black", line("a", [[0.1, 0.1], [0.2, 0.2]]));
    const placed = usePresentationStore.getState().boardStrokes.black;

    usePresentationStore.getState().replaceDrawing("black", line("a", [[0.2, 0.1], [0.3, 0.2]]));
    usePresentationStore.getState().replaceDrawing("black", line("a", [[0.3, 0.1], [0.4, 0.2]]));
    usePresentationStore.getState().sealBoardHistory("black");
    usePresentationStore.getState().replaceDrawing("black", line("a", [[0.5, 0.1], [0.6, 0.2]]));

    usePresentationStore.getState().undoBoard("black");
    expect(usePresentationStore.getState().boardStrokes.black[0].points[0].x).toBeCloseTo(0.3);
    usePresentationStore.getState().undoBoard("black");
    expect(usePresentationStore.getState().boardStrokes.black).toBe(placed);
  });

  it("records removing a board item and skips removing one that is already gone", () => {
    usePresentationStore.getState().addBoardStroke("white", line("a", [[0.1, 0.1], [0.2, 0.2]]));
    usePresentationStore.getState().selectDrawing({ surface: "white", id: "a" });

    usePresentationStore.getState().removeDrawing("white", "a");
    const depth = usePresentationStore.getState().boardHistory.white.undo.length;
    usePresentationStore.getState().removeDrawing("white", "a");

    expect(usePresentationStore.getState().boardHistory.white.undo).toHaveLength(depth);
    expect(usePresentationStore.getState().selectedDrawing).toBeNull();
    usePresentationStore.getState().undoBoard("white");
    expect(ids("white")).toEqual(["a"]);
  });

  it("does nothing when there is no step to undo or redo", () => {
    const before = usePresentationStore.getState().boardStrokes;

    usePresentationStore.getState().undoBoard("black");
    usePresentationStore.getState().redoBoard("white");

    expect(usePresentationStore.getState().boardStrokes).toBe(before);
  });
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("board pens", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    usePresentationStore.getState().resetPrefs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers the pen per board colour and stores it with the presentation preferences", () => {
    usePresentationStore.getState().setBoardPen("black", { penColor: "#22D3EE", penWidth: 10 });
    usePresentationStore.getState().setBoardPen("white", { highlighterColor: "#86EFAC" });

    const { boardPens } = usePresentationStore.getState();
    expect(boardPens.black).toMatchObject({ penColor: "#22D3EE", penWidth: 10, highlighterColor: DEFAULT_BOARD_PENS.black.highlighterColor });
    expect(boardPens.white).toMatchObject({ penColor: DEFAULT_BOARD_PENS.white.penColor, highlighterColor: "#86EFAC" });
    expect(readPrefs().boardPens).toEqual(boardPens);
  });

  it("keeps board pen sizes inside their ranges", () => {
    usePresentationStore.getState().setBoardPen("white", { penWidth: 500, eraserSize: 3 });

    expect(usePresentationStore.getState().boardPens.white).toMatchObject({ penWidth: 24, eraserSize: 12 });
  });

  it("falls back to defaults for missing or broken stored values", () => {
    expect(readBoardPens(undefined)).toEqual(DEFAULT_BOARD_PENS);
    expect(readBoardPens({ black: { penColor: 5, penWidth: -2, eraserSize: 60 }, white: "oops" })).toEqual({
      black: { ...DEFAULT_BOARD_PENS.black, eraserSize: 60 },
      white: DEFAULT_BOARD_PENS.white,
    });
    localStorage.setItem("vivepdf.presentation", JSON.stringify({ penWidth: 4, boardPens: { white: { penWidth: 16 } } }));
    expect(readPrefs()).toMatchObject({ penWidth: 4, boardPens: { black: DEFAULT_BOARD_PENS.black, white: { ...DEFAULT_BOARD_PENS.white, penWidth: 16 } } });
  });
});
