import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addElements } from "../model/edit";
import { createDesign, createShape } from "../model/design";
import { Canvas } from "./Canvas";
import { lineEndpoints } from "./lineGeometry";
import { currentPage, useStudioStore } from "./studioStore";
import { DEFAULT_VIEW_PREFS, useViewPrefs } from "./viewPrefs";

function pointer(target: Element, type: string, clientX: number, clientY: number, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0, ...init });
  Object.assign(event, { pointerId: 1, isPrimary: true });
  act(() => {
    target.dispatchEvent(event);
  });
}

function page() {
  const current = currentPage(useStudioStore.getState());
  if (!current) throw new Error("no page");
  return current;
}

function elementNode(id: string): Element {
  const node = document.querySelector(`[data-element-id="${id}"]`);
  if (!node) throw new Error(`no element ${id}`);
  return node;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  useViewPrefs.setState({ ...DEFAULT_VIEW_PREFS, snap: false });
  const design = createDesign("Card", 300, 200);
  const first = createShape("rect", 10, 10, 50, 50);
  const second = createShape("ellipse", 120, 10, 50, 50);
  useStudioStore.getState().open({ ...design, pages: [addElements(design.pages[0], [first, second])] });
  useStudioStore.getState().setZoom(1);
});

afterEach(() => {
  cleanup();
  useStudioStore.getState().close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("studio canvas", () => {
  it("duplicates the selection with Alt+drag and moves only the copy in one undo step", () => {
    render(<Canvas language="en" />);
    const [first] = page().elements;

    pointer(elementNode(first.id), "pointerdown", 20, 20, { altKey: true });
    pointer(screen.getByTestId("studio-viewport"), "pointermove", 60, 30, { altKey: true });
    expect(screen.getByTestId("studio-readout").textContent).toBe("X 17.6  Y 7.1 mm");
    pointer(screen.getByTestId("studio-viewport"), "pointerup", 60, 30);

    const elements = page().elements;
    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({ id: first.id, x: 10, y: 10 });
    expect(elements[2]).toMatchObject({ x: 50, y: 20, kind: "shape" });
    expect(useStudioStore.getState().selection).toEqual([elements[2].id]);
    act(() => useStudioStore.getState().undo());
    expect(page().elements).toHaveLength(2);
  });

  it("drops the copy and restores the selection when the drag is cancelled", () => {
    render(<Canvas language="en" />);
    const [first] = page().elements;

    pointer(elementNode(first.id), "pointerdown", 20, 20, { altKey: true });
    pointer(screen.getByTestId("studio-viewport"), "pointermove", 60, 30, { altKey: true });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(page().elements).toHaveLength(2);
    expect(useStudioStore.getState().selection).toEqual([first.id]);
    expect(useStudioStore.getState().past).toHaveLength(0);
  });

  it("flags the drag as an interaction until the pointer is released or the drag is cancelled", () => {
    render(<Canvas language="en" />);
    const [first] = page().elements;
    const viewport = screen.getByTestId("studio-viewport");

    pointer(elementNode(first.id), "pointerdown", 20, 20);
    expect(useStudioStore.getState().interacting).toBe(false);
    pointer(viewport, "pointermove", 60, 30);
    expect(useStudioStore.getState().interacting).toBe(true);
    pointer(viewport, "pointerup", 60, 30);
    expect(useStudioStore.getState().interacting).toBe(false);
    expect(page().elements[0].x).toBe(50);

    pointer(elementNode(first.id), "pointerdown", 60, 30);
    pointer(viewport, "pointermove", 90, 30);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useStudioStore.getState().interacting).toBe(false);
    expect(page().elements[0].x).toBe(50);
  });

  it("outlines the element under the pointer unless it is selected", () => {
    render(<Canvas language="en" />);
    const [first, second] = page().elements;

    pointer(elementNode(second.id), "pointermove", 130, 20);
    expect(screen.getByTestId("studio-hover")).toBeTruthy();

    act(() => useStudioStore.getState().select([second.id]));
    expect(screen.queryByTestId("studio-hover")).toBeNull();
    pointer(elementNode(first.id), "pointermove", 20, 20);
    expect(screen.getByTestId("studio-hover")).toBeTruthy();
  });

  it("pulls a guide out of the ruler, moves it and drops it back to remove it", () => {
    render(<Canvas language="en" />);
    const ruler = screen.getByTestId("studio-ruler-x");

    pointer(ruler, "pointerdown", 100, -5);
    pointer(ruler, "pointermove", 100, 60);
    pointer(ruler, "pointerup", 100, 60);

    expect(page().guides).toEqual([{ axis: "y", position: 60 }]);
    const guide = screen.getByTestId("studio-guide");
    pointer(guide, "pointerdown", 100, 60);
    pointer(screen.getByTestId("studio-viewport"), "pointermove", 100, -4);
    pointer(screen.getByTestId("studio-viewport"), "pointerup", 100, -4);
    expect(page().guides).toEqual([]);
    act(() => useStudioStore.getState().undo());
    expect(page().guides).toEqual([{ axis: "y", position: 60 }]);
  });

  it("ignores a plain click on the ruler and adds or removes guides on double-click", () => {
    render(<Canvas language="en" />);
    const ruler = screen.getByTestId("studio-ruler-y");

    pointer(ruler, "pointerdown", -5, 80);
    pointer(ruler, "pointerup", -5, 80);
    expect(page().guides).toEqual([]);

    fireEvent.doubleClick(ruler, { clientX: -5, clientY: 80 });
    expect(page().guides).toEqual([{ axis: "y", position: 80 }]);
    fireEvent.doubleClick(screen.getByTestId("studio-guide"));
    expect(page().guides).toEqual([]);
  });

  it("turns a multi-selection as a whole around its centre", () => {
    render(<Canvas language="en" />);
    const ids = page().elements.map((element) => element.id);
    act(() => useStudioStore.getState().select(ids));
    const grip = document.querySelector('[data-handle="rotate"]');
    if (!grip) throw new Error("no rotate grip");

    pointer(grip, "pointerdown", 190, 35);
    pointer(screen.getByTestId("studio-viewport"), "pointermove", 90, 135);
    pointer(screen.getByTestId("studio-viewport"), "pointerup", 90, 135);

    const [first, second] = page().elements;
    expect(first.rotation).toBe(90);
    expect(second.rotation).toBe(90);
    expect(first.x + first.width / 2).toBeCloseTo(90);
    expect(first.y + first.height / 2).toBeCloseTo(-20);
    expect(second.y + second.height / 2).toBeCloseTo(90);
  });

  it("hides the rulers and the guides when the view says so", () => {
    useViewPrefs.setState({ rulers: false, guides: false });
    act(() => useStudioStore.getState().applyToPage((current) => ({ ...current, guides: [{ axis: "x", position: 30 }] })));

    render(<Canvas language="en" />);

    expect(screen.queryByTestId("studio-ruler-x")).toBeNull();
    expect(screen.queryByTestId("studio-guide")).toBeNull();
  });
});

describe("line ends on the canvas", () => {
  it("drags one end, keeps the other and steps the angle with Shift in one undo step", () => {
    const line = createShape("line", 20, 112, 100, 16);
    act(() => {
      useStudioStore.getState().applyToPage((current) => addElements(current, [line]));
      useStudioStore.getState().select([line.id]);
    });
    render(<Canvas language="en" />);
    const viewport = screen.getByTestId("studio-viewport");

    pointer(screen.getByTestId("studio-line-end"), "pointerdown", 120, 120);
    pointer(viewport, "pointermove", 120, 190);
    pointer(viewport, "pointermove", 118, 220, { shiftKey: true });
    pointer(viewport, "pointerup", 118, 220);

    const moved = page().elements.find((element) => element.id === line.id);
    if (!moved) throw new Error("line lost");
    const ends = lineEndpoints(moved);
    expect(moved.rotation).toBeCloseTo(45);
    expect(moved.width).toBeCloseTo(Math.hypot(98, 100));
    expect(ends.start.x).toBeCloseTo(20);
    expect(ends.start.y).toBeCloseTo(120);
    act(() => useStudioStore.getState().undo());
    expect(page().elements.find((element) => element.id === line.id)).toMatchObject({ x: 20, y: 112, width: 100, rotation: 0 });
  });

  it("shows end handles instead of resize handles and puts the line back on Escape", () => {
    const line = createShape("line", 20, 112, 100, 16);
    act(() => {
      useStudioStore.getState().applyToPage((current) => addElements(current, [line]));
      useStudioStore.getState().select([line.id]);
    });
    render(<Canvas language="en" />);

    expect(document.querySelector('[data-handle="e"]')).toBeNull();
    pointer(screen.getByTestId("studio-line-start"), "pointerdown", 20, 120);
    pointer(screen.getByTestId("studio-viewport"), "pointermove", 60, 40);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(page().elements.find((element) => element.id === line.id)).toMatchObject({ x: 20, y: 112, width: 100, rotation: 0 });
  });
});
