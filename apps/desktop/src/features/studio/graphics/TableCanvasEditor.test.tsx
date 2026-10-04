import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { StudioSvgElement } from "@/types/studio";

vi.mock("@/shared/rpc/operations", () => ({ studioSaveDraft: vi.fn(async () => ({ bytes: 1, savedAt: 1 })), fontFile: vi.fn(async () => ({ base64: "", ext: "none", italic: false })) }));

const { useStudioStore } = await import("../design/studioStore");
const { createDesign, createSvg } = await import("../model/design");
const { createTableData } = await import("./tableModel");
const { graphicOf } = await import("./graphicData");
const { useTableEdit } = await import("./graphicEditor");
const { TableCanvasEditor } = await import("./TableCanvasEditor");

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>';

function Host() {
  const element = useStudioStore((state) => state.design?.pages[0].elements[0] as StudioSvgElement | undefined);
  return element ? <TableCanvasEditor element={element} /> : null;
}

function cells(): string[][] {
  const element = useStudioStore.getState().design?.pages[0].elements[0];
  const graphic = element ? graphicOf(element) : null;
  return graphic?.kind === "table" ? graphic.data.cells : [];
}

function start() {
  const table: StudioSvgElement = { ...createSvg(SVG, 0, 0, 200, 40), source: "table", data: createTableData(2, 2) };
  const design = createDesign("Table", 400, 400);
  useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements: [table] }] });
  useStudioStore.getState().select([table.id]);
  useTableEdit.getState().begin(table.id, { row: 0, column: 0 });
  useStudioStore.getState().setEditing(table.id);
  render(<Host />);
}

const editor = () => screen.getByTestId("studio-table-cell-editor") as HTMLTextAreaElement;

describe("table editing on the canvas", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(start);

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("types into the active cell and merges the typing into one undo step", () => {
    fireEvent.change(editor(), { target: { value: "H" } });
    fireEvent.change(editor(), { target: { value: "Hello" } });

    expect(cells()[0][0]).toBe("Hello");
    expect(useStudioStore.getState().past).toHaveLength(1);
    expect(editor().getAttribute("aria-label")).toBe("Row 1, column 1");
  });

  it("moves with Tab and Shift+Tab and adds a row after the last cell", () => {
    fireEvent.keyDown(editor(), { key: "Tab" });
    expect(editor().getAttribute("aria-label")).toBe("Row 1, column 2");

    fireEvent.keyDown(editor(), { key: "Tab", shiftKey: true });
    expect(editor().getAttribute("aria-label")).toBe("Row 1, column 1");

    act(() => useTableEdit.getState().setRange({ anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } }));
    fireEvent.keyDown(editor(), { key: "Tab" });

    expect(cells()).toHaveLength(3);
    expect(useTableEdit.getState().range.anchor).toEqual({ row: 2, column: 0 });
  });

  it("leaves the text with the arrow keys only at its edges", () => {
    fireEvent.change(editor(), { target: { value: "ab" } });
    editor().setSelectionRange(1, 1);
    fireEvent.keyDown(editor(), { key: "ArrowRight" });
    expect(useTableEdit.getState().range.anchor).toEqual({ row: 0, column: 0 });

    editor().setSelectionRange(2, 2);
    fireEvent.keyDown(editor(), { key: "ArrowDown" });
    expect(useTableEdit.getState().range.anchor).toEqual({ row: 1, column: 0 });
  });

  it("extends the selection with Shift and clears it with Delete", () => {
    fireEvent.change(editor(), { target: { value: "a" } });
    act(() => useTableEdit.getState().setRange({ anchor: { row: 0, column: 1 }, focus: { row: 0, column: 1 } }));
    fireEvent.change(editor(), { target: { value: "b" } });
    act(() => useTableEdit.getState().setRange({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }));
    editor().setSelectionRange(1, 1);

    fireEvent.keyDown(editor(), { key: "ArrowRight", shiftKey: true });
    expect(useTableEdit.getState().range.focus).toEqual({ row: 0, column: 1 });

    fireEvent.keyDown(editor(), { key: "Delete" });
    expect(cells()[0]).toEqual(["", ""]);
  });

  it("pastes a block copied from a spreadsheet", () => {
    fireEvent.paste(editor(), { clipboardData: { getData: () => "a\tb\tc\n1\t2\t3\n4\t5\t6" } });

    expect(cells()).toEqual([["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]);
  });

  it("finishes editing with Escape", () => {
    fireEvent.keyDown(editor(), { key: "Escape" });

    expect(useStudioStore.getState().editingId).toBeNull();
  });
});
