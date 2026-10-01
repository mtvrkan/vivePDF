import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { axeViolations } from "@/test/axe";
import { DrawingEditorHost } from "../drawing/DrawingEditorHost";
import { isDrawingKind, toDrawingObject, type DrawingSource } from "../drawing/drawingSource";
import { formulaDataUrl } from "./formulaSvg";
import { typeset } from "./mathjaxEngine";

async function typeLatex(value: string) {
  const area = await screen.findByLabelText("Formula (LaTeX)");
  await act(async () => {
    fireEvent.change(area, { target: { value } });
  });
  return area as HTMLTextAreaElement;
}

async function waitForPreview(latex: string) {
  await screen.findByRole("img", { name: latex }, { timeout: 4000 });
}

function formulaOf(drawing: DrawingSource | undefined) {
  return drawing?.kind === "formula" ? drawing.source : undefined;
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

describe("FormulaEditorHost", () => {
  it("previews a formula and hands it over for placing at its natural size", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("formula", null);
    const { container } = render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Add formula" })).toBeTruthy();
    expect(screen.getByText("No formula yet")).toBeTruthy();
    await typeLatex(String.raw`E = mc^2`);
    await waitForPreview(String.raw`E = mc^2`);
    expect(await axeViolations(container)).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });
    const pending = useViewerOverlayStore.getState().pendingImage;
    expect(formulaOf(pending?.drawing)?.latex).toBe(String.raw`E = mc^2`);
    expect(pending?.path).toBeNull();
    expect(pending?.width).toBeCloseTo((formulaOf(pending?.drawing)?.emWidth ?? 0) * 18);
    expect(pending?.dataUrl.startsWith("data:image/svg+xml")).toBe(true);
    expect(useViewerOverlayStore.getState().drawingEditor).toBeNull();
  });

  it("puts a template where the caret is", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("formula", null);
    render(<DrawingEditorHost />);
    const area = await typeLatex("a + b");
    area.setSelectionRange(2, 3);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Physics" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: String.raw`E = mc^2` }));
    });
    expect(area.value).toBe(String.raw`a E = mc^2 b`);
  });

  it("builds a matrix of the chosen size and puts it at the caret", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("formula", null);
    const { container } = render(<DrawingEditorHost />);
    const area = await typeLatex("A = ");
    area.setSelectionRange(4, 4);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Matrices" }));
    });
    expect(screen.getByRole("group", { name: "Matrix builder" })).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Rows"), { target: { value: "3" } });
      fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "1" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert matrix" }));
    });
    expect(area.value).toBe("A = \\begin{bmatrix}\na_{11} \\\\\na_{21} \\\\\na_{31}\n\\end{bmatrix}");
    await waitForPreview(area.value);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("explains a LaTeX mistake and keeps Insert disabled", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("formula", null);
    render(<DrawingEditorHost />);
    const area = await typeLatex(String.raw`\frac{1}{`);
    await screen.findByText(/can't be read/i, undefined, { timeout: 4000 });
    expect(area.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("inserts with Ctrl+Enter", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("formula", null);
    render(<DrawingEditorHost />);
    const area = await typeLatex(String.raw`\sqrt{2}`);
    await waitForPreview(String.raw`\sqrt{2}`);
    await act(async () => {
      fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    });
    expect(formulaOf(useViewerOverlayStore.getState().pendingImage?.drawing)?.latex).toBe(String.raw`\sqrt{2}`);
  });

  it("updates a placed formula in place and keeps its scale", async () => {
    const first = await typeset("x");
    if ("error" in first) throw new Error(first.error);
    const formula = { latex: "x", svg: first.svg, color: "#1d4ed8", emWidth: first.emWidth, emHeight: first.emHeight };
    const placed: EditorPending = { id: "f1", kind: "image", pageIndex: 2, x: 50, y: 70, width: formula.emWidth * 24, height: formula.emHeight * 24, dataUrl: formulaDataUrl(formula), path: null, aspect: formula.emWidth / formula.emHeight, opacity: 0.8, drawing: { kind: "formula", source: formula } };
    useViewerOverlayStore.getState().addObject(placed);
    useViewerOverlayStore.getState().openDrawingEditor("formula", "f1");
    render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Edit formula" })).toBeTruthy();
    expect((screen.getByLabelText("Formula (LaTeX)") as HTMLTextAreaElement).value).toBe("x");
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("24");
    await typeLatex(String.raw`x^2 + y^2`);
    await waitForPreview(String.raw`x^2 + y^2`);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update" }));
    });
    await waitFor(() => expect(useViewerOverlayStore.getState().drawingEditor).toBeNull());
    const updated = useViewerOverlayStore.getState().objects.find((item) => item.id === "f1");
    if (!isDrawingKind(updated, "formula")) throw new Error("not a formula");
    expect(updated.drawing.source.latex).toBe(String.raw`x^2 + y^2`);
    expect(updated.drawing.source.color).toBe("#1d4ed8");
    expect(updated.x).toBe(50);
    expect(updated.y).toBe(70);
    expect(updated.width).toBeCloseTo(updated.drawing.source.emWidth * 24);
    expect(useViewerOverlayStore.getState().past.length).toBeGreaterThan(0);
  });
});

describe("toDrawingObject (formula)", () => {
  it("sends the coloured drawing in page points with its opacity", () => {
    const formula = { latex: "x", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1ex" height="1ex" viewBox="0 0 10 10"><path fill="currentColor" d="M0 0"/></svg>', color: "#ff0000", emWidth: 0.5, emHeight: 0.5 };
    const item: EditorPending = { id: "f", kind: "image", pageIndex: 0, x: 10, y: 20, width: 30, height: 40, dataUrl: "", path: null, aspect: 0.75, opacity: 0.5, drawing: { kind: "formula", source: formula } };
    if (!isDrawingKind(item, "formula")) throw new Error("not a formula");
    expect(toDrawingObject(item)).toEqual({ id: "f", kind: "drawing", page: 1, x0: 10, y0: 20, x1: 40, y1: 60, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#ff0000" d="M0 0"/></svg>', opacity: 0.5 });
  });

  it("does not treat a plain picture as a formula", () => {
    const picture: EditorPending = { id: "p", kind: "image", pageIndex: 0, x: 0, y: 0, width: 1, height: 1, dataUrl: "data:image/png;base64,", path: null, aspect: 1, opacity: 1 };
    expect(isDrawingKind(picture, "formula")).toBe(false);
  });
});
