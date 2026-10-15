import { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useBoardLiveStore } from "./boardLiveStore";
import type { LiveSignal } from "./liveSignal";
import { PresentationCanvas } from "./PresentationCanvas";

const STAGE = { left: 200, top: 100, width: 800, height: 450 };
const PAGE = { left: 400, top: 100, width: 400, height: 450 };
const originalRect = Element.prototype.getBoundingClientRect;

function Stage({ onSignal }: { onSignal: (signal: LiveSignal) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={containerRef} data-stage="">
      <div data-page-index="0" />
      <PresentationCanvas containerRef={containerRef} contained onSignal={onSignal} />
    </div>
  );
}

function capture() {
  return document.querySelector<HTMLElement>("[data-presentation-capture]") as HTMLElement;
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
    const box = this.hasAttribute("data-page-index") ? PAGE : this.hasAttribute("data-stage") ? STAGE : { left: 0, top: 0, width: 0, height: 0 };
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

describe("PresentationCanvas inside the presenter console", () => {
  it("reports the laser pointer as a point on the page", () => {
    const onSignal = vi.fn();
    act(() => usePresentationStore.getState().setTool("laser"));
    render(<Stage onSignal={onSignal} />);

    fireEvent.pointerMove(capture(), { pointerId: 1, clientX: 600, clientY: 325 });

    const last = onSignal.mock.calls.at(-1)?.[0] as LiveSignal;
    expect(last.tool).toBe("laser");
    expect(last.pageWidth).toBe(400);
    expect(last.pointer?.pageIndex).toBe(0);
    expect(last.pointer?.x).toBeCloseTo(0.5);
    expect(last.pointer?.y).toBeCloseTo(0.5);
  });

  it("places the laser dot and the spotlight inside the stage rather than on the screen", () => {
    act(() => usePresentationStore.getState().setTool("laser"));
    render(<Stage onSignal={vi.fn()} />);
    fireEvent.pointerMove(capture(), { pointerId: 1, clientX: 600, clientY: 325 });

    const dot = document.querySelector<HTMLElement>(".laser-dot") as HTMLElement;
    expect([dot.style.left, dot.style.top]).toEqual(["400px", "225px"]);
    expect(dot.className).toContain("absolute");

    act(() => usePresentationStore.getState().setTool("spotlight"));
    fireEvent.pointerMove(capture(), { pointerId: 1, clientX: 600, clientY: 325 });
    const frame = document.querySelector<HTMLElement>("[data-spotlight-frame]") as HTMLElement;
    expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual(["0px", "0px", "800px", "450px"]);
  });

  it("sends the stroke being drawn on a black screen with the live signal and clears it after", () => {
    const onSignal = vi.fn();
    render(<Stage onSignal={onSignal} />);
    const stroke = { id: "board-1", tool: "pen" as const, color: "#ffffff", width: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }] };

    act(() => useBoardLiveStore.getState().publish({ board: "black", stroke }));
    const drawing = onSignal.mock.calls.at(-1)?.[0] as LiveSignal;
    act(() => useBoardLiveStore.getState().publish(null));
    const lifted = onSignal.mock.calls.at(-1)?.[0] as LiveSignal;

    expect(drawing.activeBoardStroke).toEqual({ board: "black", stroke });
    expect(lifted.activeBoardStroke).toBeNull();
  });

  it("clears the live pointer when the pointer leaves the stage", () => {
    const onSignal = vi.fn();
    act(() => usePresentationStore.getState().setTool("laser"));
    render(<Stage onSignal={onSignal} />);
    fireEvent.pointerMove(capture(), { pointerId: 1, clientX: 600, clientY: 325 });

    fireEvent.pointerLeave(capture());

    const last = onSignal.mock.calls.at(-1)?.[0] as LiveSignal;
    expect(last.pointer).toBeNull();
    expect(last.laserPath).toBeNull();
  });

  it("streams the stroke being drawn so the audience sees it before the pen lifts", () => {
    const onSignal = vi.fn();
    act(() => usePresentationStore.getState().setTool("pen"));
    render(<Stage onSignal={onSignal} />);

    fireEvent.pointerDown(capture(), { button: 0, pointerId: 1, clientX: 500, clientY: 100 });
    fireEvent.pointerMove(capture(), { pointerId: 1, clientX: 600, clientY: 300 });

    const drawing = onSignal.mock.calls.at(-1)?.[0] as LiveSignal;
    expect(drawing.activeStroke?.pageIndex).toBe(0);
    expect(drawing.activeStroke?.stroke.points[0]).toEqual({ x: 0.25, y: 0 });
    fireEvent.pointerUp(capture(), { pointerId: 1 });
    expect((onSignal.mock.calls.at(-1)?.[0] as LiveSignal).activeStroke).toBeNull();
  });
});
