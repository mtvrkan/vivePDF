import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { axeViolations } from "@/test/axe";
import { DrawingEditorHost } from "../drawing/DrawingEditorHost";
import { isDrawingKind, toDrawingObject, type DrawingSource } from "../drawing/drawingSource";
import { initialParams, shapeById } from "./catalog";
import { DEFAULT_SHAPE_STYLE, renderShape, shapeDataUrl } from "./render";
import type { ShapeSource } from "./shapeObject";

function sourceOf(id: string, params = {}): ShapeSource {
  const shape = shapeById(id);
  if (!shape) throw new Error(`missing ${id}`);
  const values = { ...initialParams(shape), ...params };
  const rendered = renderShape(shape.build(values), { ...DEFAULT_SHAPE_STYLE, labels: false }, new Map());
  return { id, params: values, style: { ...DEFAULT_SHAPE_STYLE, labels: false }, svg: rendered.svg, width: rendered.width, height: rendered.height };
}

function shapeOf(drawing: DrawingSource | undefined) {
  return drawing?.kind === "shape" ? drawing.source : undefined;
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

describe("ShapeEditorHost", () => {
  it("picks a shape from a group and hands it over for placing at its natural size", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("shape", null);
    const { container } = render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Add shape" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Geometry" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Regular polygon" }));
    });
    expect(screen.getByRole("radio", { name: "Regular polygon" }).getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.change(screen.getByRole("slider", { name: "Sides" }), { target: { value: "5" } });
    });
    expect(await axeViolations(container)).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });
    await waitFor(() => expect(useViewerOverlayStore.getState().drawingEditor).toBeNull());
    const pending = useViewerOverlayStore.getState().pendingImage;
    expect(shapeOf(pending?.drawing)?.id).toBe("polygon");
    expect(shapeOf(pending?.drawing)?.params.sides).toBe(5);
    expect(pending?.path).toBeNull();
    expect(pending?.width).toBeCloseTo(shapeOf(pending?.drawing)?.width ?? 0);
    expect(pending?.dataUrl.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("offers turning only for solids", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("shape", null);
    render(<DrawingEditorHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Solids" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Cylinder" }));
    });
    expect(screen.getByRole("slider", { name: "Turn" })).toBeTruthy();
    expect(screen.getByText("Drag the preview to turn the solid.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Circuits" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Resistor" }));
    });
    expect(screen.queryByRole("slider", { name: "Turn" })).toBeNull();
    expect(screen.queryByText("Drag the preview to turn the solid.")).toBeNull();
  });

  it("updates a placed shape in place and keeps its scale", async () => {
    const shape = sourceOf("circle");
    const placed: EditorPending = { id: "s1", kind: "image", pageIndex: 1, x: 40, y: 60, width: shape.width * 2, height: shape.height * 2, dataUrl: shapeDataUrl(shape.svg), path: null, aspect: shape.width / shape.height, opacity: 1, drawing: { kind: "shape", source: shape } };
    useViewerOverlayStore.getState().addObject(placed);
    useViewerOverlayStore.getState().openDrawingEditor("shape", "s1");
    render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Edit shape" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Circle" }).getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.change(screen.getByRole("slider", { name: "Radius" }), { target: { value: "100" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update" }));
    });
    await waitFor(() => expect(useViewerOverlayStore.getState().drawingEditor).toBeNull());
    const updated = useViewerOverlayStore.getState().objects.find((item) => item.id === "s1");
    if (!isDrawingKind(updated, "shape")) throw new Error("not a shape");
    expect(updated.drawing.source.params.radius).toBe(100);
    expect(updated.x).toBe(40);
    expect(updated.y).toBe(60);
    expect(updated.width).toBeCloseTo(updated.drawing.source.width * 2);
    expect(updated.width).toBeGreaterThan(placed.width);
    expect(useViewerOverlayStore.getState().past.length).toBeGreaterThan(0);
  });
});

describe("toDrawingObject (shape)", () => {
  it("sends the drawing in page points with its opacity", () => {
    const shape = sourceOf("square");
    const item: EditorPending = { id: "q", kind: "image", pageIndex: 0, x: 10, y: 20, width: 30, height: 30, dataUrl: "", path: null, aspect: 1, opacity: 0.4, drawing: { kind: "shape", source: shape } };
    if (!isDrawingKind(item, "shape")) throw new Error("not a shape");
    expect(toDrawingObject(item)).toEqual({ id: "q", kind: "drawing", page: 1, x0: 10, y0: 20, x1: 40, y1: 50, svg: shape.svg, opacity: 0.4 });
  });

  it("does not treat a plain picture as a shape", () => {
    const picture: EditorPending = { id: "p", kind: "image", pageIndex: 0, x: 0, y: 0, width: 1, height: 1, dataUrl: "data:image/png;base64,", path: null, aspect: 1, opacity: 1 };
    expect(isDrawingKind(picture, "shape")).toBe(false);
  });
});
