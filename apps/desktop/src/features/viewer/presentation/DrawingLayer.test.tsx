import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import { LiveStrokeCanvas, PageDrawingCanvas } from "./DrawingLayer";

const RECT = { pageIndex: 0, left: 10, top: 20, width: 400, height: 300 };
const STROKE: Stroke = { id: "ink-1", tool: "pen", color: "#000000", width: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] };

const getContext = vi.fn(() => null);

beforeEach(() => {
  getContext.mockClear();
  HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof HTMLCanvasElement.prototype.getContext;
  usePresentationStore.getState().resetSession();
});

afterEach(cleanup);

describe("PageDrawingCanvas", () => {
  it("draws the page ink once and not again when only its position moves", () => {
    usePresentationStore.getState().addStroke(0, STROKE);
    const { rerender } = render(<PageDrawingCanvas rect={RECT} />);

    rerender(<PageDrawingCanvas rect={{ ...RECT, left: 60 }} />);

    expect(getContext).toHaveBeenCalledTimes(1);
    expect(document.querySelector("canvas")?.style.left).not.toBe("");
  });

  it("draws again when a stroke is added", () => {
    usePresentationStore.getState().addStroke(0, STROKE);
    render(<PageDrawingCanvas rect={RECT} />);

    usePresentationStore.getState().addStroke(0, { ...STROKE, id: "ink-2" });
    render(<PageDrawingCanvas rect={RECT} />);

    expect(getContext.mock.calls.length).toBeGreaterThan(1);
  });

  it("draws nothing for a page without ink", () => {
    render(<PageDrawingCanvas rect={RECT} />);

    expect(document.querySelector("canvas")).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
  });
});

describe("LiveStrokeCanvas", () => {
  it("skips the redraw when the same stroke renders again", () => {
    const { rerender } = render(<LiveStrokeCanvas rect={RECT} stroke={STROKE} />);

    rerender(<LiveStrokeCanvas rect={RECT} stroke={STROKE} />);
    rerender(<LiveStrokeCanvas rect={RECT} stroke={{ ...STROKE, points: [...STROKE.points, { x: 0.6, y: 0.6 }] }} />);

    expect(getContext).toHaveBeenCalledTimes(2);
  });
});
