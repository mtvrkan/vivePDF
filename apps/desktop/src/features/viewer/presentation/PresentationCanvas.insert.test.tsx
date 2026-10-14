import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore, type Stroke } from "@/shared/store/presentationStore";

const bridge = vi.hoisted(() => ({ edit: vi.fn() }));
vi.mock("./drawingInsert", () => ({ editPresentationDrawing: bridge.edit }));

const { PresentationCanvas } = await import("./PresentationCanvas");

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

function pageStrokes(): Stroke[] {
  return usePresentationStore.getState().strokesByPage[0] ?? [];
}

function armFormula(width = 153, height = 51) {
  act(() => {
    const store = usePresentationStore.getState();
    const asset = store.addDrawingAsset({ dataUrl: "data:image/svg+xml,formula", width, height });
    store.armPlacement(asset);
  });
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
  bridge.edit.mockReset();
  usePresentationStore.getState().resetSession();
  usePresentationStore.getState().resetPrefs();
});

afterEach(cleanup);

describe("PresentationCanvas inserted items", () => {
  it("places a waiting item where the page is clicked, selects it and shows its picture under the ink", () => {
    render(<Stage />);
    armFormula();
    expect(screen.getByRole("status").textContent).toContain("Click the page");
    expect(capture().style.cursor).toBe("copy");

    fireEvent.pointerDown(capture(), { button: 0, pointerId: 1, clientX: 500, clientY: 250 });

    const [stroke] = pageStrokes();
    expect(stroke).toMatchObject({ tool: "drawing", size: { width: expect.closeTo(0.25), height: expect.closeTo(1 / 6) } });
    expect(stroke.points[0].x).toBeCloseTo(0.375);
    expect(stroke.points[0].y).toBeCloseTo(0.5 - 1 / 12);
    expect(usePresentationStore.getState().placing).toBeNull();
    expect(usePresentationStore.getState().selectedDrawing).toEqual({ surface: 0, id: stroke.id });
    const picture = document.querySelector<HTMLImageElement>(`[data-presentation-item="${stroke.id}"]`) as HTMLImageElement;
    expect(picture.getAttribute("src")).toBe("data:image/svg+xml,formula");
    expect([picture.style.left, picture.style.top, picture.style.width]).toEqual(["400px", `${50 + 400 * stroke.points[0].y}px`, "200px"]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("drops a waiting item when another tool is picked", () => {
    render(<Stage />);
    armFormula();

    act(() => usePresentationStore.getState().setTool("pen"));

    expect(usePresentationStore.getState().placing).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens a placed item for editing on a double click or from its frame, and never offers rotation", () => {
    render(<Stage />);
    armFormula();
    fireEvent.pointerDown(capture(), { button: 0, pointerId: 1, clientX: 500, clientY: 250 });
    const [stroke] = pageStrokes();

    fireEvent.doubleClick(capture(), { clientX: 500, clientY: 250 });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(bridge.edit).toHaveBeenCalledTimes(2);
    expect(bridge.edit).toHaveBeenCalledWith(0, stroke);
    expect(document.querySelector("[data-rotate-handle]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Style/ })).toBeNull();
  });

  it("ignores a double click beside every item", () => {
    render(<Stage />);
    act(() => usePresentationStore.getState().setTool("select"));

    fireEvent.doubleClick(capture(), { clientX: 150, clientY: 80 });

    expect(bridge.edit).not.toHaveBeenCalled();
  });
});
