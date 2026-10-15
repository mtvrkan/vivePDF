import { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";
import { measureLabel } from "./measure";
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

function drag(points: Array<[number, number]>) {
  const capture = document.querySelector<HTMLElement>("[data-presentation-capture]") as HTMLElement;
  const [first, ...rest] = points;
  fireEvent.pointerDown(capture, { button: 0, pointerId: 1, clientX: first[0], clientY: first[1] });
  for (const [x, y] of rest) fireEvent.pointerMove(capture, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(capture, { pointerId: 1 });
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
  useDocumentStore.setState({ activeId: "d", documents: { d: { info: { pageSizes: [{ width: 600, height: 300 }] } } } as never });
  usePresentationStore.getState().resetSession();
  usePresentationStore.getState().resetPrefs();
});

afterEach(() => {
  cleanup();
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
});

describe("PresentationCanvas with the ruler and measure", () => {
  it("lays a pen line started at the ruler edge straight along it", () => {
    act(() => {
      usePresentationStore.getState().setRuler({ pageIndex: 0, x: 0.1, y: 0.5, angle: 0, pageWidthPt: 600 });
      usePresentationStore.getState().setPenWidth(4);
      usePresentationStore.getState().setTool("pen");
    });
    render(<Stage />);

    drag([
      [300, 242],
      [400, 236],
      [500, 246],
    ]);

    const [line] = pageStrokes();
    expect(line.points.length).toBeGreaterThan(1);
    for (const point of line.points) expect(point.y).toBeCloseTo((248 - PAGE.top) / PAGE.height);
    expect(line.points.at(-1)?.x).toBeCloseTo(0.5);
  });

  it("leaves a pen line started away from the ruler as drawn", () => {
    act(() => {
      usePresentationStore.getState().setRuler({ pageIndex: 0, x: 0.1, y: 0.5, angle: 0, pageWidthPt: 600 });
      usePresentationStore.getState().setTool("pen");
    });
    render(<Stage />);

    drag([
      [300, 120],
      [400, 160],
    ]);

    expect(pageStrokes()[0].points.at(-1)).toEqual({ x: 0.375, y: 0.275 });
  });

  it("draws a measure that carries the page size for its real length", () => {
    act(() => {
      usePresentationStore.getState().setShapeKind("measure");
      usePresentationStore.getState().setTool("shape");
    });
    render(<Stage />);

    drag([
      [300, 150],
      [500, 150],
    ]);

    const [measure] = pageStrokes();
    expect(measure).toMatchObject({ tool: "measure", pageSize: { width: 600, height: 300 } });
    expect(measureLabel(measure, "en")).toBe("5.3 cm");
  });
});
