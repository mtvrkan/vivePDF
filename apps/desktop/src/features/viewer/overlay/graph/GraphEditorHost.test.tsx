import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { axeViolations } from "@/test/axe";
import { DrawingEditorHost } from "../drawing/DrawingEditorHost";
import { isDrawingKind, toDrawingObject, type DrawingSource } from "../drawing/drawingSource";
import { renderShape, shapeDataUrl } from "../shapes/render";
import type { GraphSource } from "./graphObject";
import { DEFAULT_GRAPH, GRAPH_STYLE, planGraph, type GraphSettings } from "./plot";

function sourceOf(settings: GraphSettings): GraphSource {
  const rendered = renderShape(planGraph(settings).primitives, GRAPH_STYLE, new Map());
  return { settings, svg: rendered.svg, width: rendered.width, height: rendered.height };
}

async function typeFunction(name: string, value: string) {
  const input = screen.getByRole("textbox", { name: `Function ${name}(x)` });
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  return input as HTMLInputElement;
}

function graphOf(drawing: DrawingSource | undefined) {
  return drawing?.kind === "graph" ? drawing.source : undefined;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  useViewerOverlayStore.getState().setMode("image");
});

afterEach(() => {
  cleanup();
  useViewerOverlayStore.getState().setMode(null);
});

describe("GraphEditorHost", () => {
  it("plots typed functions and hands the graph over for placing at its natural size", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("graph", null);
    const { container } = render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Add function graph" })).toBeTruthy();
    await typeFunction("f", "x^3 - 3x");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add function" }));
    });
    await typeFunction("g", "sin x");
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "x from" }), { target: { value: "-3" } });
    });
    expect(await axeViolations(container)).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });
    await waitFor(() => expect(useViewerOverlayStore.getState().drawingEditor).toBeNull());
    const pending = useViewerOverlayStore.getState().pendingImage;
    expect(graphOf(pending?.drawing)?.settings.functions.map((item) => item.expression)).toEqual(["x^3 - 3x", "sin x"]);
    expect(graphOf(pending?.drawing)?.settings.xMin).toBe(-3);
    expect(pending?.width).toBeCloseTo(graphOf(pending?.drawing)?.width ?? 0);
    expect(pending?.dataUrl.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("explains a mistake and keeps Insert disabled until it is fixed", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("graph", null);
    render(<DrawingEditorHost />);
    const input = await typeFunction("f", "2 * foo");
    expect(screen.getByText("“foo” is not a known name. Use x, pi, e or a function such as sin.")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(true);
    await typeFunction("f", "(x + 1");
    expect(screen.getByText("A “(” is not closed.")).toBeTruthy();
    await typeFunction("f", "x +");
    expect(screen.getByText("The function ends too early.")).toBeTruthy();
    await typeFunction("f", "x + 1");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("puts an example into the row being edited", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("graph", null);
    render(<DrawingEditorHost />);
    if (!screen.queryByRole("textbox", { name: "Function g(x)" })) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Add function" }));
      });
    }
    const second = screen.getByRole("textbox", { name: "Function g(x)" });
    await act(async () => {
      fireEvent.focus(second);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ln x" }));
    });
    expect((second as HTMLInputElement).value).toBe("ln x");
    for (const name of ["p", "h", "g"]) {
      const remove = screen.queryByRole("button", { name: `Remove ${name}(x)` });
      if (!remove) continue;
      await act(async () => {
        fireEvent.click(remove);
      });
    }
    expect(screen.queryByRole("textbox", { name: "Function g(x)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove f(x)" })).toBeNull();
  });

  it("shows the fitted y axis and keeps it when automatic is turned off", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("graph", null);
    render(<DrawingEditorHost />);
    await typeFunction("f", "x^2");
    const yFrom = screen.getByRole("textbox", { name: "y from" }) as HTMLInputElement;
    const yTo = screen.getByRole("textbox", { name: "y to" }) as HTMLInputElement;
    expect(yFrom.disabled).toBe(true);
    const fitted = [yFrom.value, yTo.value];
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Automatic y axis" }));
    });
    expect(yFrom.disabled).toBe(false);
    expect([yFrom.value, yTo.value]).toEqual(fitted);
    await act(async () => {
      fireEvent.change(yTo, { target: { value: "-" } });
    });
    expect(yTo.value).toBe("-");
    await act(async () => {
      fireEvent.change(yTo, { target: { value: "10" } });
    });
    expect(yTo.value).toBe("10");
  });

  it("updates a placed graph in place and keeps its scale", async () => {
    const graph = sourceOf(DEFAULT_GRAPH);
    const placed: EditorPending = { id: "g1", kind: "image", pageIndex: 0, x: 30, y: 50, width: graph.width * 1.5, height: graph.height * 1.5, dataUrl: shapeDataUrl(graph.svg), path: null, aspect: graph.width / graph.height, opacity: 1, drawing: { kind: "graph", source: graph } };
    useViewerOverlayStore.getState().addObject(placed);
    useViewerOverlayStore.getState().openDrawingEditor("graph", "g1");
    render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Edit graph" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Function f(x)" }) as HTMLInputElement).value).toBe("x^2 - 2");
    await typeFunction("f", "cos x");
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Grid" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update" }));
    });
    await waitFor(() => expect(useViewerOverlayStore.getState().drawingEditor).toBeNull());
    const updated = useViewerOverlayStore.getState().objects.find((item) => item.id === "g1");
    if (!isDrawingKind(updated, "graph")) throw new Error("not a graph");
    expect(updated.drawing.source.settings.functions[0].expression).toBe("cos x");
    expect(updated.drawing.source.settings.grid).toBe(false);
    expect(updated.x).toBe(30);
    expect(updated.width).toBeCloseTo(updated.drawing.source.width * 1.5);
    expect(useViewerOverlayStore.getState().past.length).toBeGreaterThan(0);
  });
});

describe("toDrawingObject (graph)", () => {
  it("sends the drawing in page points with its opacity", () => {
    const graph = sourceOf(DEFAULT_GRAPH);
    const item: EditorPending = { id: "g", kind: "image", pageIndex: 2, x: 10, y: 20, width: 100, height: 80, dataUrl: "", path: null, aspect: 1.25, opacity: 0.7, drawing: { kind: "graph", source: graph } };
    if (!isDrawingKind(item, "graph")) throw new Error("not a graph");
    expect(toDrawingObject(item)).toEqual({ id: "g", kind: "drawing", page: 3, x0: 10, y0: 20, x1: 110, y1: 100, svg: graph.svg, opacity: 0.7 });
  });
});
