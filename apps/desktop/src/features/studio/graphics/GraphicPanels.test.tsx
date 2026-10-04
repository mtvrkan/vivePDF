import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { StudioSvgElement } from "@/types/studio";

const tablePreview = vi.fn();
vi.mock("@/shared/rpc/operations", () => ({ tablePreview, chartPreview: vi.fn(), flowchartPreview: vi.fn(), studioSaveDraft: vi.fn(async () => ({ bytes: 1, savedAt: 1 })), fontFile: vi.fn(async () => ({ base64: "", ext: "none", italic: false })) }));

const { useStudioStore } = await import("../design/studioStore");
const { createDesign, createSvg } = await import("../model/design");
const { newChart, DEFAULT_CHART_LOOK } = await import("@/features/viewer/overlay/chart/chartModel");
const { useToastStore } = await import("@/shared/store/toastStore");
const { createTableData } = await import("./tableModel");
const { graphicOf } = await import("./graphicData");
const { useGraphicEditor, useTableEdit } = await import("./graphicEditor");
const { useGraphicStatus } = await import("./graphicSync");
const { GraphicsElements } = await import("./GraphicsElements");
const { GraphicSection } = await import("./GraphicSection");

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>';

function openWith(elements: StudioSvgElement[] = []) {
  const design = createDesign("Graphics", 400, 400);
  useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements }] });
  if (elements.length) useStudioStore.getState().select([elements[0].id]);
}

const first = () => useStudioStore.getState().design?.pages[0].elements[0] as StudioSvgElement;

function Section() {
  const element = useStudioStore((state) => state.design?.pages[0].elements[0] as StudioSvgElement | undefined);
  return element ? <GraphicSection element={element} /> : null;
}

function tableData() {
  const element = first();
  const graphic = graphicOf(element);
  if (graphic?.kind !== "table") throw new Error("not a table");
  return graphic.data;
}

describe("graphics in the studio panels", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
    useGraphicEditor.getState().close();
    useGraphicStatus.setState({ status: {} });
    tablePreview.mockReset();
  });

  it("adds a table of the picked size and starts editing its first cell", async () => {
    openWith();
    tablePreview.mockResolvedValue({ svg: SVG, width: 270, height: 60, missingGlyphs: "", rowHeights: [30, 30], columnWidths: [90, 90, 90] });
    render(<GraphicsElements page={useStudioStore.getState().design!.pages[0]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a table" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add a table with 2 rows and 3 columns" })));

    const element = first();
    expect(element.source).toBe("table");
    expect(tableData().cells).toEqual([["", "", ""], ["", "", ""]]);
    expect(tableData().rendered).not.toBe("");
    expect(element.height).toBeCloseTo((60 * element.width) / 270);
    expect(useStudioStore.getState().editingId).toBe(element.id);
    expect(tablePreview.mock.calls[0][0].cells).toHaveLength(2);
  });

  it("moves through the size picker with the arrow keys", () => {
    openWith();
    render(<GraphicsElements page={useStudioStore.getState().design!.pages[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a table" }));
    const start = screen.getByRole("button", { name: "Add a table with 3 rows and 3 columns" });

    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Add a table with 3 rows and 4 columns" }), { key: "ArrowDown" });

    expect(screen.getByText("4 rows × 4 columns")).toBeTruthy();
  });

  it("reports a table that cannot be drawn", async () => {
    openWith();
    tablePreview.mockRejectedValue({ code: "INVALID_PARAMS", message: "font", data: { reason: "fontUnreadable" } });
    const push = vi.spyOn(useToastStore.getState(), "push");
    render(<GraphicsElements page={useStudioStore.getState().design!.pages[0]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a table" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add a table with 1 rows and 1 columns" })));

    expect(push).toHaveBeenCalledWith("error", expect.any(String));
    expect(useStudioStore.getState().design?.pages[0].elements).toHaveLength(0);
  });

  it("opens the chart editor with the chosen chart type", () => {
    openWith();
    render(<GraphicsElements page={useStudioStore.getState().design!.pages[0]} />);

    fireEvent.click(screen.getByRole("button", { name: "Pie" }));

    expect(useGraphicEditor.getState().request).toEqual({ kind: "chart", elementId: null, chartType: "pie" });
  });

  it("changes the table look, size and header from the properties", () => {
    openWith([{ ...createSvg(SVG, 0, 0, 200, 40), source: "table", data: createTableData(2, 2) }]);
    render(<Section />);

    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove a column" }));
    fireEvent.click(screen.getByRole("switch", { name: "First row is the table header" }));
    fireEvent.click(screen.getByRole("button", { name: /Blue/ }));

    expect(tableData().cells).toHaveLength(3);
    expect(tableData().cells[0]).toHaveLength(1);
    expect(tableData().header).toBe(true);
    expect(tableData().headerFill).toBe("#bfdbfe");
    expect(screen.getByRole("button", { name: /Blue/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("styles the selected cells while editing", () => {
    const table: StudioSvgElement = { ...createSvg(SVG, 0, 0, 200, 40), source: "table", data: createTableData(2, 2) };
    openWith([table]);
    useTableEdit.getState().begin(table.id, { row: 1, column: 0 });
    useStudioStore.getState().setEditing(table.id);
    render(<Section />);

    fireEvent.click(screen.getByRole("button", { name: "Align right" }));
    fireEvent.click(screen.getByRole("switch", { name: "Fill the cells" }));
    fireEvent.click(screen.getByRole("button", { name: "Row below" }));

    expect(tableData().styles[1][0]).toEqual({ align: "right", fill: "#e5e7eb" });
    expect(tableData().cells).toHaveLength(3);
  });

  it("shows a failed render with a way to try again", () => {
    const table: StudioSvgElement = { ...createSvg(SVG, 0, 0, 200, 40), source: "table", data: createTableData(2, 2) };
    openWith([table]);
    useGraphicStatus.getState().set(table.id, { state: "error", key: "x", error: { code: "INVALID_PARAMS", message: "too tall", data: { reason: "tableTooTall" } } });
    tablePreview.mockReturnValue(new Promise(() => {}));
    render(<Section />);

    expect(screen.getByTestId("studio-graphic-error")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(tablePreview).toHaveBeenCalled();
    expect(screen.getByTestId("studio-graphic-rendering")).toBeTruthy();
  });

  it("edits chart options in place and opens the data editor", () => {
    const settings = newChart(DEFAULT_CHART_LOOK, [["", "Sales"], ["A", "1"]]);
    openWith([{ ...createSvg(SVG, 0, 0, 300, 200), source: "chart", data: { kind: "chart", settings, rendered: "" } }]);
    render(<Section />);

    fireEvent.click(screen.getByRole("switch", { name: "Show values" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit chart data" }));

    const graphic = graphicOf(first());
    expect(graphic?.kind === "chart" && graphic.data.settings.valueLabels).toBe(true);
    expect(useGraphicEditor.getState().request).toEqual({ kind: "chart", elementId: first().id });
  });
});
