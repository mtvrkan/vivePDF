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
