import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { parseClipboardGrid } from "@/features/viewer/overlay/grid/gridModel";
import type { StudioDesign, StudioSvgElement } from "@/types/studio";
import { updateElement, updatePage } from "../model/edit";
import { ensureFace, faceCss, faceKey, useStudioFontsStore } from "../design/fonts";
import { currentPage, useStudioStore } from "../design/studioStore";
import { graphicOf } from "./graphicData";
import { updateTable, useTableEdit } from "./graphicEditor";
import {
  cellAlign,
  cellBold,
  cellColor,
  cellFill,
  clampRange,
  clearRange,
  insertRow,
  moveColumnBorder,
  neighbour,
  pasteGrid,
  rangeBounds,
  rangeSize,
  setCellText,
  tableGeometry,
  type CellMove,
  type CellRef,
  type StudioTableData,
} from "./tableModel";

const PADDING = 0.4;
const LINE_HEIGHT = 1.25;
const EMPTY_FILL = "#ffffff";

type Drag = { kind: "cells" } | { kind: "border"; border: number; origin: { x: number; y: number }; before: StudioDesign; data: StudioTableData };

function same(a: CellRef, b: CellRef): boolean {
  return a.row === b.row && a.column === b.column;
}

function cellAt(x: number, y: number): CellRef | null {
  for (const node of document.elementsFromPoint(x, y)) {
    const value = (node as HTMLElement).dataset?.tableCell;
    if (!value) continue;
    const [row, column] = value.split(":").map(Number);
    return { row, column };
  }
  return null;
}

function svgSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function CellEditor({ element, data, cell, box, hintId }: { element: StudioSvgElement; data: StudioTableData; cell: CellRef; box: { left: number; top: number; width: number; height: number }; hintId: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [top, setTop] = useState(box.top);
  const value = data.cells[cell.row]?.[cell.column] ?? "";
  const bold = cellBold(data, cell);
  const weight = bold ? 700 : 400;
  const face = useStudioFontsStore((state) => state.faces[faceKey(data.fontId, weight, false)]);
  const font = faceCss(face, weight, false);
  const range = useTableEdit((state) => state.range);
  const setRange = useTableEdit((state) => state.setRange);
  const padding = data.fontSize * PADDING;

  useEffect(() => {
    void ensureFace(data.fontId, weight, false);
  }, [data.fontId, weight]);

  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  }, [cell.row, cell.column]);

  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = "auto";
    const height = Math.max(area.scrollHeight, data.fontSize * LINE_HEIGHT + padding * 2);
    area.style.height = `${height}px`;
    setTop(box.top + Math.max(0, (box.height - height) / 2));
  }, [value, box.top, box.height, box.width, data.fontSize, padding, font.fontFamily]);

  const go = (target: CellRef) => setRange({ anchor: target, focus: target });

  const move = (direction: CellMove, extend: boolean) => {
    const from = extend ? range.focus : cell;
    const target = neighbour(data, from, direction);
    if (!target) return false;
    if (extend) setRange({ anchor: cell, focus: target });
    else go(target);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const area = event.currentTarget;
    const collapsed = area.selectionStart === area.selectionEnd;
    const caret = area.selectionStart;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      useStudioStore.getState().setEditing(null);
      return;
    }
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (move(event.shiftKey ? "previous" : "next", false) || event.shiftKey) return;
      const rows = data.cells.length;
      updateTable(element.id, (current) => insertRow(current, rows));
      go({ row: rows, column: 0 });
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && rangeSize(range) > 1) {
      event.preventDefault();
      updateTable(element.id, (current) => clearRange(current, clampRange(current, range)));
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const atStart = collapsed && caret === 0;
    const atEnd = collapsed && caret === area.value.length;
    const firstLine = collapsed && !area.value.slice(0, caret).includes("\n");
    const lastLine = collapsed && !area.value.slice(caret).includes("\n");
    const edges: Record<string, [boolean, CellMove]> = { ArrowUp: [firstLine, "up"], ArrowDown: [lastLine, "down"], ArrowLeft: [atStart, "left"], ArrowRight: [atEnd, "right"] };
    const edge = edges[event.key];
    if (edge && edge[0] && move(edge[1], event.shiftKey)) event.preventDefault();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const grid = parseClipboardGrid(event.clipboardData.getData("text/plain"));
    if (!grid || (grid.length < 2 && (grid[0]?.length ?? 0) < 2)) return;
    event.preventDefault();
    updateTable(element.id, (current) => pasteGrid(current, cell, grid));
  };

  return (
    <>
      <div aria-hidden style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, background: cellFill(data, cell) ?? EMPTY_FILL }} />
      <textarea
        ref={ref}
        value={value}
        rows={1}
        spellCheck
        data-testid="studio-table-cell-editor"
        aria-label={t("studio.graphics.cell", { row: cell.row + 1, column: cell.column + 1 })}
        aria-describedby={hintId}
        onChange={(event) => updateTable(element.id, (current) => setCellText(current, cell, event.target.value), `table-text:${element.id}:${cell.row}:${cell.column}`)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        style={{
          position: "absolute",
          left: box.left,
          top,
          width: box.width,
          padding,
          margin: 0,
          border: 0,
          outline: "none",
          resize: "none",
          overflow: "hidden",
          background: "transparent",
          color: cellColor(data, cell),
          fontFamily: font.fontFamily,
          fontStyle: font.fontStyle,
          fontWeight: font.fontWeight,
          fontSize: data.fontSize,
          lineHeight: LINE_HEIGHT,
          textAlign: cellAlign(data, cell),
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      />
    </>
  );
}

export function TableCanvasEditor({ element }: { element: StudioSvgElement }) {
  const { t } = useTranslation();
  const hintId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const zoom = useStudioStore((state) => state.zoom);
  const editingTable = useTableEdit((state) => state.elementId);
  const storedRange = useTableEdit((state) => state.range);
  const setRange = useTableEdit((state) => state.setRange);
  const [dragging, setDragging] = useState<number | null>(null);
  const graphic = graphicOf(element);
  const data = graphic?.kind === "table" ? graphic.data : null;

  useLayoutEffect(() => {
    if (!data) return;
    if (useTableEdit.getState().elementId !== element.id) useTableEdit.getState().begin(element.id, { row: 0, column: 0 });
    const entry = useTableEdit.getState().takeEntry();
    const cell = entry ? cellAt(entry.x, entry.y) : null;
    if (cell) setRange({ anchor: cell, focus: cell });
  }, [data, element.id, setRange]);

  if (!data) return null;
  const range = clampRange(data, editingTable === element.id ? storedRange : { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } });
  const geometry = tableGeometry(data, element.width, element.height);
  const rectOf = (top: number, left: number, bottom: number, right: number) => ({ left: geometry.columns[left], top: geometry.rows[top], width: geometry.columns[right + 1] - geometry.columns[left], height: geometry.rows[bottom + 1] - geometry.rows[top] });
  const anchor = range.anchor;
  const bounds = rangeBounds(range);
  const outline = 2 / zoom;
  const grip = 8 / zoom;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea")) return;
    const border = target.closest<HTMLElement>("[data-table-border]")?.dataset.tableBorder;
    const state = useStudioStore.getState();
    if (border !== undefined && state.design) {
      event.preventDefault();
      rootRef.current?.setPointerCapture(event.pointerId);
      drag.current = { kind: "border", border: Number(border), origin: { x: event.clientX, y: event.clientY }, before: state.design, data };
      setDragging(Number(border));
      return;
    }
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) return;
    event.preventDefault();
    rootRef.current?.setPointerCapture(event.pointerId);
    drag.current = { kind: "cells" };
    setRange(event.shiftKey ? { anchor: range.anchor, focus: cell } : { anchor: cell, focus: cell });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    if (current.kind === "cells") {
      const cell = cellAt(event.clientX, event.clientY);
      if (cell && !same(cell, range.focus)) setRange({ anchor: range.anchor, focus: cell });
      return;
    }
    const angle = (-element.rotation * Math.PI) / 180;
    const dx = event.clientX - current.origin.x;
    const dy = event.clientY - current.origin.y;
    const along = (dx * Math.cos(angle) - dy * Math.sin(angle)) / zoom;
    const next = moveColumnBorder(current.data, current.border, along, element.width);
    const state = useStudioStore.getState();
    const page = currentPage(state);
    if (page) state.preview(() => updatePage(current.before, page.id, (item) => updateElement<StudioSvgElement>(item, element.id, { data: next })));
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    setDragging(null);
    if (current?.kind === "border") useStudioStore.getState().settle(current.before);
    if (current) rootRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={t("studio.graphics.tableEditor")}
      data-testid="studio-table-editor"
      className="absolute inset-0"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <img src={svgSource(element.svg)} alt="" draggable={false} className="pointer-events-none block h-full w-full" />
      {data.cells.map((row, rowIndex) =>
        row.map((_, column) => <div key={`${rowIndex}:${column}`} data-table-cell={`${rowIndex}:${column}`} aria-hidden className="absolute cursor-text" style={rectOf(rowIndex, column, rowIndex, column)} />),
      )}
      {rangeSize(range) > 1 ? <div aria-hidden className="pointer-events-none absolute bg-primary/15" style={rectOf(bounds.top, bounds.left, bounds.bottom, bounds.right)} /> : null}
      <CellEditor element={element} data={data} cell={anchor} box={rectOf(anchor.row, anchor.column, anchor.row, anchor.column)} hintId={hintId} />
      <div aria-hidden className="pointer-events-none absolute border-primary" style={{ ...rectOf(anchor.row, anchor.column, anchor.row, anchor.column), borderWidth: outline }} />
      {geometry.columns.slice(1, -1).map((x, index) => (
        <div key={index} data-table-border={index} aria-hidden className="group absolute top-0 flex h-full cursor-col-resize justify-center" style={{ left: x - grip / 2, width: grip }}>
          <span className={dragging === index ? "h-full bg-primary" : "h-full bg-primary opacity-0 group-hover:opacity-60"} style={{ width: outline }} />
        </div>
      ))}
      <span id={hintId} className="sr-only">
        {t("studio.graphics.tableKeys")}
      </span>
    </div>
  );
}
