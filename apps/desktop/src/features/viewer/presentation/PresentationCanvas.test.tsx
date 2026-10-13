import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import { PresentationCanvas } from "./PresentationCanvas";

const PAGE = { left: 100, top: 50, width: 800, height: 400 };
const originalRect = Element.prototype.getBoundingClientRect;

function Stage() {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={containerRef}>
      <div data-page-index="0" />
      <PresentationCanvas containerRef={containerRef} />
    </div>
  );
}

function capture() {
  return document.querySelector<HTMLElement>("[data-presentation-capture]") as HTMLElement;
}

function drag(points: Array<[number, number]>) {
  const [first, ...rest] = points;
  fireEvent.pointerDown(capture(), { button: 0, pointerId: 1, clientX: first[0], clientY: first[1] });
  for (const [x, y] of rest) fireEvent.pointerMove(capture(), { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(capture(), { pointerId: 1 });
}

function pageStrokes(): Stroke[] {
  return usePresentationStore.getState().strokesByPage[0] ?? [];
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const box = this.hasAttribute("data-page-index") ? PAGE : { left: 0, top: 0, width: 1200, height: 600 };
    return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box } as DOMRect;
  };
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  vi.unstubAllGlobals();
});

beforeEach(() => {
  usePresentationStore.getState().resetSession();
  usePresentationStore.getState().resetPrefs();
});

afterEach(cleanup);

describe("PresentationCanvas", () => {
  it("draws a rectangle with the shape tool at the picked pixel width", () => {
    act(() => {
      usePresentationStore.getState().setShapeKind("rect");
      usePresentationStore.getState().setPenWidth(5);
      usePresentationStore.getState().setTool("shape");
    });
    render(<Stage />);

    drag([
      [300, 150],
      [400, 200],
      [500, 250],
    ]);

    const [box] = pageStrokes();
    expect(box).toMatchObject({ tool: "rect", points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }] });
    expect(box.width * PAGE.width).toBeCloseTo(5);
  });

  it("ignores a shape tool click that does not drag", () => {
    act(() => usePresentationStore.getState().setTool("shape"));
    render(<Stage />);

    drag([[300, 150]]);

    expect(pageStrokes()).toEqual([]);
  });

  it("selects a drawing, drags it to a new place and deletes it", () => {
    act(() => {
      usePresentationStore.getState().addStroke(0, { id: "box", tool: "rect", color: "#000000", width: 0.005, points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }] });
      usePresentationStore.getState().setTool("select");
    });
    render(<Stage />);

    drag([
      [400, 200],
      [480, 240],
    ]);

    expect(usePresentationStore.getState().selectedDrawing).toEqual({ surface: 0, id: "box" });
    const [moved] = pageStrokes();
    expect(moved.points[0].x).toBeCloseTo(0.35);
    expect(moved.points[0].y).toBeCloseTo(0.35);
    expect((document.querySelector("[data-presentation-selection]") as HTMLElement).style.left).toBe("372px");

    fireEvent.click(screen.getByRole("button", { name: "Delete drawing" }));

    expect(pageStrokes()).toEqual([]);
    expect(usePresentationStore.getState().selectedDrawing).toBeNull();
  });

  it("resizes a selected drawing from a corner, keeps the ratio with Shift and steps it with the buttons", () => {
    act(() => {
      usePresentationStore.getState().addStroke(0, { id: "box", tool: "rect", color: "#000000", width: 0.005, points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }] });
      usePresentationStore.getState().setTool("select");
      usePresentationStore.getState().selectDrawing({ surface: 0, id: "box" });
    });
    render(<Stage />);
    const corner = document.querySelector<HTMLElement>('[data-resize-handle="se"]') as HTMLElement;

    fireEvent.pointerDown(corner, { button: 0, pointerId: 2, clientX: 500, clientY: 250 });
    fireEvent.pointerMove(corner, { pointerId: 2, clientX: 600, clientY: 270 });
    expect(pageStrokes()[0].points[1].x).toBeCloseTo(0.625);
    expect(pageStrokes()[0].points[1].y).toBeCloseTo(0.55);
    fireEvent.pointerMove(corner, { pointerId: 2, clientX: 600, clientY: 270, shiftKey: true });
    fireEvent.pointerUp(corner, { pointerId: 2 });

    const [resized] = pageStrokes();
    expect(resized.points[0]).toEqual({ x: 0.25, y: 0.25 });
    expect(resized.points[1].x).toBeCloseTo(0.625);
    expect(resized.points[1].y).toBeCloseTo(0.625);
    expect(resized.width).toBeCloseTo(0.0075);
    expect(usePresentationStore.getState().selectedDrawing).toEqual({ surface: 0, id: "box" });

    fireEvent.click(screen.getByRole("button", { name: "Make smaller" }));
    const [smaller] = pageStrokes();
    expect(smaller.points[1].x - smaller.points[0].x).toBeCloseTo(0.375 / 1.15);
  });

  it("rotates a selected drawing with the buttons and the handle, snapping with Shift", () => {
    act(() => {
      usePresentationStore.getState().addStroke(0, { id: "bar", tool: "line", color: "#000000", width: 0.005, points: [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }] });
      usePresentationStore.getState().setTool("select");
      usePresentationStore.getState().selectDrawing({ surface: 0, id: "bar" });
    });
    render(<Stage />);

    fireEvent.click(screen.getByRole("button", { name: "Rotate right" }));
    expect(pageStrokes()[0].points[0].x).toBeCloseTo(0.375);
    expect(pageStrokes()[0].points[0].y).toBeCloseTo(0.25);
    fireEvent.click(screen.getByRole("button", { name: "Rotate left" }));
    expect(pageStrokes()[0].points[0].x).toBeCloseTo(0.25);
    expect(pageStrokes()[0].points[0].y).toBeCloseTo(0.5);

    const handle = document.querySelector<HTMLElement>("[data-rotate-handle]") as HTMLElement;
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 600, clientY: 400 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 510, clientY: 310, shiftKey: true });
    fireEvent.pointerUp(handle, { pointerId: 3 });

    const [turned] = pageStrokes();
    expect(turned.tool).toBe("line");
    expect(turned.points[0].x).toBeCloseTo(0.375);
    expect(turned.points[0].y).toBeCloseTo(0.25);
    expect(turned.points[1].y).toBeCloseTo(0.75);
  });

  it("offers no rotation for text", () => {
    act(() => {
      usePresentationStore.getState().addStroke(0, { id: "note", tool: "text", color: "#000000", width: 0, points: [{ x: 0.25, y: 0.25 }], text: "Eski", fontSize: 0.04, size: { width: 0.1, height: 0.1 } });
      usePresentationStore.getState().setTool("select");
      usePresentationStore.getState().selectDrawing({ surface: 0, id: "note" });
    });
    render(<Stage />);

    expect(screen.queryByRole("button", { name: "Rotate right" })).toBeNull();
    expect(document.querySelector("[data-rotate-handle]")).toBeNull();
    expect(screen.getByRole("button", { name: "Duplicate drawing" })).toBeTruthy();
  });

  it("duplicates a selected drawing and selects the copy", () => {
    act(() => {
      usePresentationStore.getState().addStroke(0, { id: "box", tool: "rect", color: "#000000", width: 0.005, points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }] });
      usePresentationStore.getState().setTool("select");
      usePresentationStore.getState().selectDrawing({ surface: 0, id: "box" });
    });
    render(<Stage />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate drawing" }));

    const [original, copy] = pageStrokes();
    expect(original.id).toBe("box");
    expect(copy).toMatchObject({ tool: "rect", color: "#000000" });
    expect(copy.points[0].x).toBeCloseTo(0.27);
    expect(copy.points[0].y).toBeCloseTo(0.29);
    expect(usePresentationStore.getState().selectedDrawing).toEqual({ surface: 0, id: copy.id });
  });

  it("restyles a selected drawing from its own panel and closes the panel on a click outside", () => {
    act(() => {
      usePresentationStore.getState().addStroke(0, { id: "box", tool: "rect", color: "#000000", width: 0.005, points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }] });
      usePresentationStore.getState().setTool("select");
      usePresentationStore.getState().selectDrawing({ surface: 0, id: "box" });
    });
    render(<Stage />);

    fireEvent.click(screen.getByRole("button", { name: "Drawing style" }));
    const panel = document.querySelector<HTMLElement>("[data-drawing-style]") as HTMLElement;
    const swatches = panel.querySelectorAll<HTMLButtonElement>("button[aria-pressed]");
    fireEvent.click(swatches[1]);
    fireEvent.change(screen.getByRole("slider", { name: /Thickness/ }), { target: { value: "12" } });
    fireEvent.change(screen.getByRole("slider", { name: /Opacity/ }), { target: { value: "0.5" } });

    const [styled] = pageStrokes();
    expect(styled.color).toBe(swatches[1].getAttribute("aria-label"));
    expect(styled.width * PAGE.width).toBeCloseTo(12);
    expect(styled.opacity).toBeCloseTo(0.5);

    fireEvent.pointerDown(document.body);
    expect(document.querySelector("[data-drawing-style]")).toBeNull();
  });

  it("lets go of the selection on a click beside every drawing", () => {
    act(() => {
      usePresentationStore.getState().addStroke(0, { id: "box", tool: "rect", color: "#000000", width: 0.005, points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }] });
      usePresentationStore.getState().setTool("select");
      usePresentationStore.getState().selectDrawing({ surface: 0, id: "box" });
    });
    render(<Stage />);

    drag([[800, 400]]);

    expect(usePresentationStore.getState().selectedDrawing).toBeNull();
    expect(pageStrokes()).toHaveLength(1);
  });

  it("places typed text where the page was clicked and drops a cancelled one", () => {
    act(() => {
      usePresentationStore.getState().setTextSize(32);
      usePresentationStore.getState().setTool("text");
    });
    render(<Stage />);

    fireEvent.pointerDown(capture(), { button: 0, pointerId: 1, clientX: 300, clientY: 150 });
    const field = screen.getByRole("textbox", { name: "Text" });
    fireEvent.change(field, { target: { value: "Merhaba" } });
    fireEvent.keyDown(field, { key: "Enter" });

    const [label] = pageStrokes();
    expect(label).toMatchObject({ tool: "text", text: "Merhaba", points: [{ x: 0.25, y: 0.25 }] });
    expect((label.fontSize ?? 0) * PAGE.width).toBeCloseTo(32);
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.pointerDown(capture(), { button: 0, pointerId: 1, clientX: 700, clientY: 350 });
    const second = screen.getByRole("textbox", { name: "Text" });
    fireEvent.change(second, { target: { value: "gone" } });
    fireEvent.keyDown(second, { key: "Escape" });

    expect(pageStrokes()).toHaveLength(1);
  });

  it("blacks out everything around the document while the spotlight follows the pointer", () => {
    act(() => usePresentationStore.getState().setTool("spotlight"));
    render(<Stage />);

    expect(document.querySelector("[data-spotlight-frame]")).toBeNull();
    fireEvent.pointerMove(capture(), { pointerId: 1, clientX: 300, clientY: 150 });

    const frame = document.querySelector<HTMLElement>("[data-spotlight-frame]") as HTMLElement;
    expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual(["0px", "0px", "1200px", "600px"]);
    fireEvent.pointerLeave(capture());
    expect(document.querySelector("[data-spotlight-frame]")).toBeNull();
  });

  it("opens a placed text again for editing when the text tool clicks on it", () => {
    act(() => {
      usePresentationStore.getState().addStroke(0, { id: "note", tool: "text", color: "#000000", width: 0, points: [{ x: 0.25, y: 0.25 }], text: "Eski", fontSize: 0.04, size: { width: 0.1, height: 0.1 } });
      usePresentationStore.getState().setTool("text");
    });
    render(<Stage />);

    drag([[310, 160]]);
    const field = screen.getByRole("textbox", { name: "Text" }) as HTMLTextAreaElement;
    expect(field.value).toBe("Eski");
    fireEvent.change(field, { target: { value: "Yeni" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(pageStrokes()).toHaveLength(1);
    expect(pageStrokes()[0]).toMatchObject({ id: "note", text: "Yeni", fontSize: 0.04, points: [{ x: 0.25, y: 0.25 }] });
  });

  it("moves a placed text when the text tool drags it, without opening it for editing", () => {
    act(() => {
      usePresentationStore.getState().addStroke(0, { id: "note", tool: "text", color: "#000000", width: 0, points: [{ x: 0.25, y: 0.25 }], text: "Eski", fontSize: 0.04, size: { width: 0.1, height: 0.1 } });
      usePresentationStore.getState().setTool("text");
    });
    render(<Stage />);

    drag([
      [310, 160],
      [390, 200],
    ]);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(pageStrokes()).toHaveLength(1);
    expect(pageStrokes()[0].points[0].x).toBeCloseTo(0.35);
    expect(pageStrokes()[0].points[0].y).toBeCloseTo(0.35);
  });
});
