import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "./documentStore";
import { eraseFromStroke, eraseFromStrokes, usePresentationStore, type Stroke } from "./presentationStore";

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
