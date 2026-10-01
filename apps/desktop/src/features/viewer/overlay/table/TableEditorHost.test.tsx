import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { tablePreview } from "@/shared/rpc/operations";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { axeViolations } from "@/test/axe";
import type { TableSpec } from "@/types";
import { DrawingEditorHost } from "../drawing/DrawingEditorHost";
import { isDrawingKind } from "../drawing/drawingSource";
import { DEFAULT_TABLE } from "./tableModel";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@/shared/rpc/operations", () => ({
  fontCatalogue: vi.fn(async () => ({ fonts: [{ id: "bundled:dejavu-sans", name: "DejaVu Sans", source: "bundled" }] })),
  addFont: vi.fn(),
  removeFont: vi.fn(),
  tablePreview: vi.fn(async (spec: TableSpec) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.cells.length * 20}"/>`, width: spec.width, height: spec.cells.length * 20, missingGlyphs: "" })),
}));

function table() {
  return screen.getByRole("table");
}

async function type(label: string, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

async function previewReady() {
  await waitFor(() => expect(screen.getByRole("img", { name: "Table preview" }).querySelector("img")).toBeTruthy(), { timeout: 3000 });
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  vi.mocked(tablePreview).mockClear();
  useViewerOverlayStore.getState().setMode("image");
});

afterEach(() => {
  cleanup();
  useViewerOverlayStore.getState().setMode(null);
});

describe("TableEditorHost", () => {
  it("starts empty, previews what is typed and hands the table over for placing", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("table", null);
    const { container } = render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Add table" })).toBeTruthy();
    expect(screen.getByText("The table is empty")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(true);
    expect(table().querySelectorAll("tbody tr")).toHaveLength(4);
    await type("Row 1, column 1", "Name");
    await type("Row 2, column 1", "Ada");
    await previewReady();
    expect(await axeViolations(container)).toEqual([]);
    expect(vi.mocked(tablePreview).mock.calls.at(-1)?.[0].cells[0][0]).toBe("Name");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });
    const pending = useViewerOverlayStore.getState().pendingImage;
    expect(pending?.drawing?.kind).toBe("table");
    expect(pending?.width).toBe(DEFAULT_TABLE.width);
    expect(pending?.height).toBe(80);
    expect(useViewerOverlayStore.getState().drawingEditor).toBeNull();
  });

  it("fills and grows the grid from a pasted spreadsheet selection", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("table", null);
    render(<DrawingEditorHost />);
    await act(async () => {
      fireEvent.paste(screen.getByLabelText("Row 4, column 3"), { clipboardData: { getData: () => "x\ty\nz\tw\n" } });
    });
    expect(table().querySelectorAll("tbody tr")).toHaveLength(5);
    expect((screen.getByLabelText("Row 5, column 4") as HTMLInputElement).value).toBe("w");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove column 4" }));
      fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    });
    expect(table().querySelectorAll("tbody tr")).toHaveLength(6);
    expect(screen.queryByLabelText("Row 1, column 4")).toBeNull();
  });

  it("explains a refused table and offers a retry", async () => {
    vi.mocked(tablePreview).mockRejectedValue({ code: "INVALID_PARAMS", message: "too tall", data: { reason: "tableTooTall", height: 15000 } });
    useViewerOverlayStore.getState().openDrawingEditor("table", null);
    render(<DrawingEditorHost />);
    await type("Row 1, column 1", "a lot of text");
    expect(await screen.findByText(/too tall for a page \(15000 pt\)/, undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    vi.mocked(tablePreview).mockReset();
  });

  it("updates a placed table in place and keeps its scale on the page", async () => {
    const settings = { ...DEFAULT_TABLE, cells: [["a", "b"]], align: ["left", "left"] as const };
    const placed: EditorPending = { id: "t1", kind: "image", pageIndex: 0, x: 20, y: 30, width: 200, height: 10, dataUrl: "", path: null, aspect: 20, opacity: 1, drawing: { kind: "table", source: { settings: { ...settings, align: [...settings.align] }, svg: "<svg/>", width: 400, height: 20 } } };
    useViewerOverlayStore.getState().addObject(placed);
    useViewerOverlayStore.getState().openDrawingEditor("table", "t1");
    render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Edit table" })).toBeTruthy();
    expect((screen.getByLabelText("Row 1, column 2") as HTMLInputElement).value).toBe("b");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    });
    await previewReady();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update" }));
    });
    const updated = useViewerOverlayStore.getState().objects.find((item) => item.id === "t1");
    if (!isDrawingKind(updated, "table")) throw new Error("not a table");
    expect(updated.drawing.source.settings.cells).toHaveLength(2);
    expect(updated.x).toBe(20);
    expect(updated.width).toBe(200);
    expect(updated.height).toBe(20);
    expect(useViewerOverlayStore.getState().past.length).toBeGreaterThan(0);
  });
});
