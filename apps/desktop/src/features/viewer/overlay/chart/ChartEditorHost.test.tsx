import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { chartPreview } from "@/shared/rpc/operations";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { axeViolations } from "@/test/axe";
import type { ChartSpec } from "@/types";
import { DrawingEditorHost } from "../drawing/DrawingEditorHost";
import { isDrawingKind } from "../drawing/drawingSource";
import { DEFAULT_CHART_LOOK, newChart } from "./chartModel";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@/shared/rpc/operations", () => ({
  fontCatalogue: vi.fn(async () => ({ fonts: [{ id: "bundled:dejavu-sans", name: "DejaVu Sans", source: "bundled" }] })),
  addFont: vi.fn(),
  removeFont: vi.fn(),
  chartPreview: vi.fn(async (spec: ChartSpec) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}"/>`, width: spec.width ?? 360, height: spec.height ?? 240, missingGlyphs: "" })),
}));

function lastSpec(): ChartSpec | undefined {
  return vi.mocked(chartPreview).mock.calls.at(-1)?.[0];
}

async function previewReady() {
  await waitFor(() => expect(screen.getByRole("img", { name: "Chart preview" }).querySelector("img")).toBeTruthy(), { timeout: 3000 });
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  vi.mocked(chartPreview).mockClear();
  useViewerOverlayStore.getState().setMode("image");
});

afterEach(() => {
  cleanup();
  useViewerOverlayStore.getState().setMode(null);
});

describe("ChartEditorHost", () => {
  it("opens with sample data, previews it and hands the chart over for placing", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("chart", null);
    const { container } = render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Add chart" })).toBeTruthy();
    expect((screen.getByLabelText("Row 1, column 2") as HTMLInputElement).value).toBe("Series 1");
    await previewReady();
    expect(lastSpec()?.categories).toEqual(["Item 1", "Item 2", "Item 3", "Item 4"]);
    expect(lastSpec()?.decimal).toBe(".");
    expect(await axeViolations(container)).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Pie" }));
    });
    await waitFor(() => expect(lastSpec()?.type).toBe("pie"));
    expect(screen.getByText("A pie chart shows only the first series.")).toBeTruthy();
    expect(screen.queryByLabelText("Value axis title")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    });
    const pending = useViewerOverlayStore.getState().pendingImage;
    expect(pending?.drawing?.kind).toBe("chart");
    expect(pending?.width).toBe(360);
    expect(pending?.height).toBe(240);
  });

  it("marks cells that are not numbers and shows the empty state without any number", async () => {
    useViewerOverlayStore.getState().openDrawingEditor("chart", null);
    render(<DrawingEditorHost />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Row 2, column 2"), { target: { value: "lots" } });
    });
    expect(screen.getByLabelText("Row 2, column 2").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Cells marked red are not numbers and are left out.")).toBeTruthy();
    await act(async () => {
      fireEvent.paste(screen.getByLabelText("Row 2, column 2"), { clipboardData: { getData: () => "\t\n\t\n\t\n\t\n" } });
    });
    await act(async () => {
      fireEvent.paste(screen.getByLabelText("Row 2, column 2"), { clipboardData: { getData: () => "a\tb\nc\td\ne\tf\ng\th" } });
    });
    expect(screen.getByText("No numbers yet")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains a chart the engine refuses and offers a retry", async () => {
    vi.mocked(chartPreview).mockRejectedValue({ code: "INVALID_PARAMS", message: "small", data: { reason: "chartTooSmall" } });
    useViewerOverlayStore.getState().openDrawingEditor("chart", null);
    render(<DrawingEditorHost />);
    expect(await screen.findByText(/too small for its labels/, undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    vi.mocked(chartPreview).mockReset();
  });

  it("updates a placed chart in place and keeps its scale on the page", async () => {
    const settings = newChart(DEFAULT_CHART_LOOK, [["", "A"], ["x", "1"]]);
    const placed: EditorPending = { id: "c1", kind: "image", pageIndex: 0, x: 20, y: 30, width: 180, height: 120, dataUrl: "", path: null, aspect: 1.5, opacity: 1, drawing: { kind: "chart", source: { settings, svg: "<svg/>", width: 360, height: 240 } } };
    useViewerOverlayStore.getState().addObject(placed);
    useViewerOverlayStore.getState().openDrawingEditor("chart", "c1");
    render(<DrawingEditorHost />);
    expect(screen.getByRole("dialog", { name: "Edit chart" })).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Chart title"), { target: { value: "Growth" } });
    });
    await waitFor(() => expect(lastSpec()?.title).toBe("Growth"));
    await previewReady();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update" }));
    });
    const updated = useViewerOverlayStore.getState().objects.find((item) => item.id === "c1");
    if (!isDrawingKind(updated, "chart")) throw new Error("not a chart");
    expect(updated.drawing.source.settings.title).toBe("Growth");
    expect(updated.x).toBe(20);
    expect(updated.width).toBe(180);
    expect(updated.height).toBe(120);
  });
});
