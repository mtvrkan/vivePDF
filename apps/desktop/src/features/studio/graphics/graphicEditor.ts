import type { TFunction } from "i18next";
import { create } from "zustand";
import type { ColorSwatchRow } from "@/components/shared/ColorSwatch";
import type { ChartType } from "@/types";
import type { StudioElement, StudioPage, StudioSvgElement, StudioSvgSource } from "@/types/studio";
import { designColors } from "../model/colors";
import { createSvg } from "../model/design";
import { updateElement } from "../model/edit";
import { centred, insert } from "../design/insert";
import { useRecentColors } from "../design/recentColors";
import { currentPage, useStudioStore } from "../design/studioStore";
import { graphicOf, renderKeyOf, stretchSvg, tableSpec, type RenderedGraphic } from "./graphicData";
import { renderGraphic } from "./graphicSync";
import { clampRange, createTableData, type CellRange, type CellRef, type StudioTableData, type TableLook } from "./tableModel";

export type GraphicRequest = { kind: "chart"; elementId: string | null; chartType?: ChartType } | { kind: "flowchart"; elementId: string | null } | { kind: "formula"; elementId: string | null };

type GraphicEditorState = { request: GraphicRequest | null; open: (request: GraphicRequest) => void; close: () => void };

export const useGraphicEditor = create<GraphicEditorState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

type Point = { x: number; y: number };

const MAX_DOCUMENT_COLOURS = 12;

export function graphicSwatchRows(t: TFunction): ColorSwatchRow[] {
  const design = useStudioStore.getState().design;
  const rows: ColorSwatchRow[] = [];
  if (design?.palette.length) rows.push({ id: "palette", label: t("studio.graphics.designPalette"), colors: design.palette });
  rows.push({ id: "document", label: t("studio.colors.document"), colors: design ? designColors(design).slice(0, MAX_DOCUMENT_COLOURS) : [] });
  rows.push({ id: "recent", label: t("studio.colors.recent"), colors: useRecentColors.getState().colors });
  return rows;
}

type TableEditState = {
  elementId: string | null;
  range: CellRange;
  entry: Point | null;
  begin: (elementId: string, cell: CellRef, entry?: Point | null) => void;
  setRange: (range: CellRange) => void;
  takeEntry: () => Point | null;
};

const ORIGIN: CellRef = { row: 0, column: 0 };

export const useTableEdit = create<TableEditState>((set, get) => ({
  elementId: null,
  range: { anchor: ORIGIN, focus: ORIGIN },
  entry: null,
  begin: (elementId, cell, entry = null) => set({ elementId, range: { anchor: cell, focus: cell }, entry }),
  setRange: (range) => set({ range }),
  takeEntry: () => {
    const entry = get().entry;
    if (entry) set({ entry: null });
    return entry;
  },
}));

export function activeRange(element: StudioElement, data: StudioTableData): CellRange | null {
  const state = useTableEdit.getState();
  if (state.elementId !== element.id || useStudioStore.getState().editingId !== element.id) return null;
  return clampRange(data, state.range);
}

export function createGraphicElement(source: Exclude<StudioSvgSource, "import">, svg: string, box: { x: number; y: number; width: number; height: number }, data: unknown): StudioSvgElement {
  return { ...createSvg(stretchSvg(svg), box.x, box.y, box.width, box.height), source, data };
}

export function patchGraphic(id: string, change: (element: StudioSvgElement) => Partial<StudioSvgElement> | null, merge?: string) {
  const store = useStudioStore.getState();
  const page = currentPage(store);
  const element = page?.elements.find((item): item is StudioSvgElement => item.id === id && item.kind === "svg");
  if (!element) return;
  const patch = change(element);
  if (!patch) return;
  store.applyToPage((current) => updateElement<StudioSvgElement>(current, id, patch), merge ? { merge } : undefined);
}

export function updateTable(id: string, change: (data: StudioTableData, element: StudioSvgElement) => StudioTableData | { data: StudioTableData; width: number }, merge?: string) {
  patchGraphic(
    id,
    (element) => {
      const graphic = graphicOf(element);
      if (graphic?.kind !== "table") return null;
      const result = change(graphic.data, element);
      if ("kind" in result) return result === graphic.data ? null : { data: result };
      return { data: result.data, width: result.width };
    },
    merge,
  );
}

export function openGraphic(element: StudioElement, entry: Point | null = null): boolean {
  const graphic = graphicOf(element);
  if (!graphic || element.locked) return false;
  const store = useStudioStore.getState();
  store.select([element.id]);
  if (graphic.kind === "table") {
    useTableEdit.getState().begin(element.id, ORIGIN, entry);
    store.setEditing(element.id);
    return true;
  }
  useGraphicEditor.getState().open({ kind: graphic.kind, elementId: element.id });
  return true;
}

export function tableWidthFor(page: StudioPage, columns: number): number {
  return Math.min(page.width * 0.8, Math.max(200, columns * 90));
}

export async function insertTable(page: StudioPage, rows: number, columns: number, look?: TableLook): Promise<void> {
  const data = createTableData(rows, columns, look);
  const width = tableWidthFor(page, columns);
  const spec = { kind: "table" as const, spec: tableSpec(data, width) };
  const result: RenderedGraphic = await renderGraphic(spec);
  const height = (result.height * width) / result.width;
  const layout = result.rowHeights && result.columnWidths ? { width: result.width, height: result.height, rows: result.rowHeights, columns: result.columnWidths } : null;
  const element = createGraphicElement("table", result.svg, { ...centred(page, width, height), width, height }, { ...data, rendered: renderKeyOf(spec), layout });
  insert(element);
  useTableEdit.getState().begin(element.id, ORIGIN);
  useStudioStore.getState().setEditing(element.id);
}
