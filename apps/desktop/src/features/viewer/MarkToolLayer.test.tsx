import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@embedpdf/plugin-annotation/react", () => ({ useAnnotation: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-zoom/react", () => ({ useZoom: () => ({ state: { currentZoomLevel: 1 } }) }));
vi.mock("./markArea", async (original) => ({ ...(await original<typeof import("./markArea")>()), useMarkToolMode: () => "erase" }));

const { MarkToolLayer } = await import("./MarkToolLayer");

function send(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0 });
  Object.defineProperties(event, { offsetX: { value: x }, offsetY: { value: y }, pointerId: { value: 1 } });
  act(() => {
    target.dispatchEvent(event);
  });
}

function trailPoints(): string[] {
  return (document.querySelector("polyline")?.getAttribute("points") ?? "").split(" ").filter(Boolean);
}

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
});

afterEach(cleanup);

describe("MarkToolLayer eraser", () => {
  it("leaves out pointer moves too small to widen the erased path", () => {
    render(<MarkToolLayer documentId="doc" pageIndex={0} />);
    const layer = document.querySelector("[data-mark-tool]") as Element;

    send(layer, "pointerdown", 10, 10);
    send(layer, "pointermove", 11, 10);
    send(layer, "pointermove", 11, 11);
    send(layer, "pointermove", 20, 10);

    expect(trailPoints()).toEqual(["10,10", "20,10"]);
  });

  it("keeps every step that moves far enough", () => {
    render(<MarkToolLayer documentId="doc" pageIndex={0} />);
    const layer = document.querySelector("[data-mark-tool]") as Element;

    send(layer, "pointerdown", 0, 0);
    send(layer, "pointermove", 5, 0);
    send(layer, "pointermove", 10, 0);

    expect(trailPoints()).toEqual(["0,0", "5,0", "10,0"]);
  });

  it("still follows the pointer with the eraser circle on small moves", () => {
    render(<MarkToolLayer documentId="doc" pageIndex={0} />);
    const layer = document.querySelector("[data-mark-tool]") as Element;

    send(layer, "pointerdown", 10, 10);
    send(layer, "pointermove", 11, 10);

    expect(document.querySelector("circle")?.getAttribute("cx")).toBe("11");
  });
});
