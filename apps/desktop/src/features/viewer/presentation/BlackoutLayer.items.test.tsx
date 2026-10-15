import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { FormulaSource } from "@/features/viewer/overlay/formula/formulaSvg";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { BlackoutLayer } from "./BlackoutLayer";

const FORMULA: FormulaSource = { latex: "x^2", svg: "<svg/>", color: "#111111", emWidth: 2, emHeight: 1 };
const DRAWING = { kind: "formula" as const, source: FORMULA };

beforeAll(async () => {
  await ready();
  await setLocale("en");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

beforeEach(() => {
  usePresentationStore.getState().resetSession();
  useViewerOverlayStore.getState().setMode(null);
  useViewerOverlayStore.getState().closeDrawingEditor();
  useViewerOverlayStore.setState({ objects: [], past: [], future: [] });
  Object.assign(window, { innerWidth: 1000, innerHeight: 500 });
});

afterEach(cleanup);

function board() {
  return document.querySelector<HTMLElement>("[data-presentation-board]") as HTMLElement;
}

function selectionFrame() {
  return document.querySelector("[data-presentation-selection]");
}

function boardItem(): Stroke {
  const asset = usePresentationStore.getState().addDrawingAsset({ dataUrl: "data:image/png;base64,AA", width: 100, height: 50, drawing: DRAWING });
  const stroke: Stroke = { id: "item-1", tool: "drawing", color: "#000000", width: 0, points: [{ x: 0.2, y: 0.2 }], size: { width: 0.2, height: 0.2 }, asset };
  usePresentationStore.getState().addBoardStroke("black", stroke);
  return stroke;
}

function openBoard() {
  act(() => {
    usePresentationStore.getState().setBlackout("black");
    usePresentationStore.getState().setTool("select");
  });
  render(<BlackoutLayer />);
}

function click(x: number, y: number) {
  fireEvent.pointerDown(board(), { button: 0, pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(board(), { pointerId: 1 });
}

describe("BlackoutLayer items", () => {
  it("places an item waiting to be placed on the board where it is clicked and selects it", () => {
    const asset = usePresentationStore.getState().addDrawingAsset({ dataUrl: "data:image/png;base64,AA", width: 100, height: 50, drawing: DRAWING });
    act(() => usePresentationStore.getState().setBlackout("white"));
    render(<BlackoutLayer />);
    act(() => usePresentationStore.getState().armPlacement(asset));
    expect(screen.getByText("Click the page to place it — Esc cancels")).toBeTruthy();

    click(500, 250);

    const state = usePresentationStore.getState();
    const placed = state.boardStrokes.white[0];
    expect(placed).toMatchObject({ tool: "drawing", asset });
    expect((placed.points[0].x + (placed.size?.width ?? 0) / 2) * 1000).toBeCloseTo(500);
    expect(state.boardSize).toEqual({ width: 1000, height: 500 });
    expect(state.placing).toBeNull();
    expect(state.selectedDrawing).toEqual({ surface: "white", id: placed.id });
    expect(selectionFrame()).not.toBeNull();
    expect(document.querySelector(`img[data-presentation-item="${placed.id}"]`)).not.toBeNull();
  });

  it("selects a board item with a click, drags it and lets go of it on an empty spot", () => {
    const item = boardItem();
    openBoard();

    fireEvent.pointerDown(board(), { button: 0, pointerId: 1, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(board(), { pointerId: 1, clientX: 400, clientY: 200 });
    fireEvent.pointerUp(board(), { pointerId: 1 });
    const moved = usePresentationStore.getState().boardStrokes.black[0];
    click(900, 450);

    expect(moved.points[0].x).toBeCloseTo(item.points[0].x + 0.1);
    expect(moved.points[0].y).toBeCloseTo(item.points[0].y + 0.1);
    expect(usePresentationStore.getState().selectedDrawing).toBeNull();
    expect(selectionFrame()).toBeNull();
  });

  it("opens the item's editor on a double-click and moves the board below the editor meanwhile", () => {
    boardItem();
    openBoard();
    expect(board().className).toContain("z-50");

    fireEvent.doubleClick(board(), { clientX: 300, clientY: 150 });

    expect(useViewerOverlayStore.getState().drawingEditor?.kind).toBe("formula");
    expect(board().className).toContain("z-30");
    act(() => useViewerOverlayStore.getState().closeDrawingEditor());
    expect(board().className).toContain("z-50");
  });

  it("deletes the selected board item from its frame and hides the frame for drawing tools", () => {
    boardItem();
    openBoard();
    click(300, 150);
    expect(selectionFrame()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Delete drawing/ }));

    expect(usePresentationStore.getState().boardStrokes.black).toEqual([]);
    boardItem();
    click(300, 150);
    act(() => usePresentationStore.getState().setTool("pen"));
    expect(selectionFrame()).toBeNull();
  });
});
