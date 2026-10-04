import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioSvgElement } from "@/types/studio";

const tablePreview = vi.fn();
vi.mock("@/shared/rpc/operations", () => ({ tablePreview, chartPreview: vi.fn(), flowchartPreview: vi.fn(), studioSaveDraft: vi.fn(async () => ({ bytes: 1, savedAt: 1 })) }));

const { useStudioStore } = await import("../design/studioStore");
const { createDesign, createSvg } = await import("../model/design");
const { createTableData, setCellText } = await import("./tableModel");
const { graphicOf } = await import("./graphicData");
const { retryGraphic, syncGraphics, useGraphicStatus } = await import("./graphicSync");

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>';

function openTable(): StudioSvgElement {
  const table: StudioSvgElement = { ...createSvg(SVG, 0, 0, 200, 30), source: "table", data: createTableData(2, 2) };
  const design = createDesign("Graphics", 400, 400);
  useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements: [table] }] });
  return table;
}

const current = () => useStudioStore.getState().design?.pages[0].elements[0] as StudioSvgElement;

describe("graphic sync", () => {
  beforeEach(() => tablePreview.mockReset());

  afterEach(() => {
    useStudioStore.getState().close();
    useGraphicStatus.setState({ status: {} });
  });

  it("renders a stale table and patches its svg and height without an undo step", async () => {
    openTable();
    tablePreview.mockResolvedValue({ svg: SVG.replace("<svg", "<svg data-done"), width: 200, height: 60, missingGlyphs: "", rowHeights: [30, 30], columnWidths: [100, 100] });

    syncGraphics();
    await vi.waitFor(() => expect(current().height).toBe(60));

    expect(current().svg).toContain("data-done");
    expect(useStudioStore.getState().past).toHaveLength(0);
    expect(useGraphicStatus.getState().status).toEqual({});
    tablePreview.mockClear();
    syncGraphics();
    expect(tablePreview).not.toHaveBeenCalled();
  });

  it("drops a result when the table changed while it was rendering", async () => {
    openTable();
    let finish: (value: unknown) => void = () => {};
    tablePreview.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    tablePreview.mockResolvedValue({ svg: SVG, width: 200, height: 90, missingGlyphs: "", rowHeights: [45, 45], columnWidths: [100, 100] });

    syncGraphics();
    useStudioStore.getState().applyToPage((page) => ({ ...page, elements: page.elements.map((element) => {
      const graphic = graphicOf(element);
      return graphic?.kind === "table" ? { ...element, data: setCellText(graphic.data, { row: 0, column: 0 }, "New") } : element;
    }) }));
    syncGraphics();
    finish({ svg: SVG, width: 200, height: 400, missingGlyphs: "", rowHeights: [200, 200], columnWidths: [100, 100] });

    await vi.waitFor(() => expect(current().height).toBe(90));
  });

  it("reports a failed render and tries again on request", async () => {
    openTable();
    tablePreview.mockRejectedValueOnce({ code: "INVALID_PARAMS", message: "too tall", data: { reason: "tableTooTall" } });

    syncGraphics();
    await vi.waitFor(() => expect(useGraphicStatus.getState().status[current().id]?.state).toBe("error"));
    syncGraphics();
    expect(tablePreview).toHaveBeenCalledTimes(1);

    tablePreview.mockResolvedValue({ svg: SVG, width: 200, height: 50, missingGlyphs: "", rowHeights: [25, 25], columnWidths: [100, 100] });
    retryGraphic(current().id);
    await vi.waitFor(() => expect(current().height).toBe(50));
  });
});
