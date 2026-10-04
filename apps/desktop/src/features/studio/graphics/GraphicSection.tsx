import { AlignCenter, AlignLeft, AlignRight, Bold, Columns3, Minus, Pencil, Plus, RefreshCw, Rows3, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Segmented, SliderField, SwitchField, TextInput } from "@/components/tool/form";
import { CHART_TYPES, LEGEND_POSITIONS, type ChartSettings } from "@/features/viewer/overlay/chart/chartModel";
import { FLOW_DIRECTIONS, type FlowchartSettings } from "@/features/viewer/overlay/flowchart/flowchartModel";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import type { TableAlign } from "@/types";
import type { StudioSvgElement } from "@/types/studio";
import { ColorField, NumberField, PanelSection } from "../design/controls";
import { useStudioStore } from "../design/studioStore";
import { fromMm, toMm } from "../design/units";
import { formulaSvg, graphicOf, type StudioChartData, type StudioFlowchartData, type StudioFormulaData } from "./graphicData";
import { openGraphic, patchGraphic, updateTable, useTableEdit } from "./graphicEditor";
import { retryGraphic, useGraphicStatus } from "./graphicSync";
import {
  MAX_TABLE_FONT,
  MIN_TABLE_FONT,
  TABLE_ALIGNS,
  TABLE_BORDERS,
  TABLE_STYLES,
  TABLE_STYLE_IDS,
  cellAlign,
  cellBold,
  cellColor,
  clampRange,
  columnCount,
  distributeColumns,
  insertColumn,
  insertRow,
  matchingTableStyle,
  rangeBounds,
  rangeStyle,
  removeColumn,
  removeRow,
  setColumnWidth,
  styleRange,
  type CellRange,
  type StudioTableData,
} from "./tableModel";

const ALIGN_ICONS: Record<TableAlign, LucideIcon> = { left: AlignLeft, center: AlignCenter, right: AlignRight };
const DEFAULT_CELL_FILL = "#e5e7eb";
const DEFAULT_STRIPE = "#f3f4f6";
const DEFAULT_HEADER_FILL = "#e5e7eb";
const chip = "glass-chip inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-40";

function StatusLine({ id }: { id: string }) {
  const { t } = useTranslation();
  const status = useGraphicStatus((state) => state.status[id]);
  if (!status) return null;
  if (status.state === "rendering") {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="studio-graphic-rendering">
        <span className="h-2 w-16 animate-pulse rounded bg-muted" aria-hidden />
        {t("studio.graphics.updating")}
      </p>
    );
  }
  return (
    <div role="alert" className="space-y-2 text-xs text-destructive" data-testid="studio-graphic-error">
      <p>{describeError(t, status.error)}</p>
      <button type="button" className={chip} onClick={() => retryGraphic(id)}>
        <RefreshCw className="size-4" aria-hidden />
        {t("common.retry")}
      </button>
    </div>
  );
}

function Counter({ label, icon: Icon, value, onAdd, onRemove, addLabel, removeLabel, canAdd, canRemove }: { label: string; icon: LucideIcon; value: number; onAdd: () => void; onRemove: () => void; addLabel: string; removeLabel: string; canAdd: boolean; canRemove: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <span className="flex-1 text-sm text-foreground/80">{label}</span>
      <IconButton icon={Minus} label={removeLabel} disabled={!canRemove} onClick={onRemove} />
      <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">
        {value}
      </span>
      <IconButton icon={Plus} label={addLabel} disabled={!canAdd} onClick={onAdd} />
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function CellsSection({ element, data, range }: { element: StudioSvgElement; data: StudioTableData; range: CellRange }) {
  const { t } = useTranslation();
  const box = rangeBounds(range);
  const anchor = range.anchor;
  const style = rangeStyle(data, range);
  const set = (patch: Parameters<typeof styleRange>[2], merge?: string) => updateTable(element.id, (current) => styleRange(current, clampRange(current, range), patch), merge);
  const setRange = useTableEdit((state) => state.setRange);
  const column = anchor.column;
  const width = data.columns[column] * element.width;
  const goTo = (row: number, columnIndex: number) => setRange({ anchor: { row, column: columnIndex }, focus: { row, column: columnIndex } });
  return (
    <PanelSection title={t("studio.graphics.cells")}>
      <p className="text-xs text-muted-foreground">{t("studio.graphics.selection", { rows: box.bottom - box.top + 1, columns: box.right - box.left + 1 })}</p>
      <div className="flex items-center gap-1" role="group" aria-label={t("studio.graphics.align")}>
        {TABLE_ALIGNS.map((align) => (
          <IconButton key={align} icon={ALIGN_ICONS[align]} label={t(`studio.graphics.aligns.${align}`)} active={cellAlign(data, anchor) === align} aria-pressed={cellAlign(data, anchor) === align} onClick={() => set({ align })} />
        ))}
        <IconButton icon={Bold} label={t("studio.graphics.bold")} active={cellBold(data, anchor)} aria-pressed={cellBold(data, anchor)} onClick={() => set({ bold: !cellBold(data, anchor) })} />
      </div>
      <ColorField label={t("studio.graphics.cellText")} value={cellColor(data, anchor)} onChange={(color) => set({ color }, "cell-color")} />
      <SwitchField label={t("studio.graphics.cellFill")} checked={Boolean(style.fill)} onChange={(on) => set({ fill: on ? DEFAULT_CELL_FILL : null })} />
      {style.fill ? <ColorField label={t("studio.graphics.cellFillColor")} value={style.fill} onChange={(fill) => set({ fill }, "cell-fill")} /> : null}
      <NumberField
        label={t("studio.graphics.columnWidth", { column: column + 1 })}
        suffix="mm"
        value={toMm(width)}
        min={4}
        step={1}
        onChange={(value) => updateTable(element.id, (current) => setColumnWidth(current, column, fromMm(value), element.width))}
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={chip} onClick={() => updateTable(element.id, (current) => insertRow(current, box.top))}>
          {t("studio.graphics.rowAbove")}
        </button>
        <button type="button" className={chip} onClick={() => updateTable(element.id, (current) => insertRow(current, box.bottom + 1))}>
          {t("studio.graphics.rowBelow")}
        </button>
        <button type="button" className={chip} onClick={() => updateTable(element.id, (current) => insertColumn(current, box.left))}>
          {t("studio.graphics.columnLeft")}
        </button>
        <button type="button" className={chip} onClick={() => updateTable(element.id, (current) => insertColumn(current, box.right + 1))}>
          {t("studio.graphics.columnRight")}
        </button>
        <button
          type="button"
          className={chip}
          disabled={data.cells.length <= 1}
          onClick={() => {
            updateTable(element.id, (current) => removeRow(current, anchor.row));
            goTo(Math.max(0, Math.min(anchor.row, data.cells.length - 2)), anchor.column);
          }}
        >
          {t("studio.graphics.deleteRow")}
        </button>
        <button
          type="button"
          className={chip}
          disabled={columnCount(data) <= 1}
          onClick={() => {
            updateTable(element.id, (current) => removeColumn(current, anchor.column));
            goTo(anchor.row, Math.max(0, Math.min(anchor.column, columnCount(data) - 2)));
          }}
        >
          {t("studio.graphics.deleteColumn")}
        </button>
      </div>
    </PanelSection>
  );
}

function TableSection({ element, data }: { element: StudioSvgElement; data: StudioTableData }) {
  const { t } = useTranslation();
  const editing = useStudioStore((state) => state.editingId === element.id);
  const storedRange = useTableEdit((state) => (state.elementId === element.id ? state.range : null));
  const range = editing && storedRange ? clampRange(data, storedRange) : null;
  const look = matchingTableStyle(data);
  const set = (patch: Partial<StudioTableData>, merge?: string) => updateTable(element.id, (current) => ({ ...current, ...patch }), merge);
  const rows = data.cells.length;
  const columns = columnCount(data);
  const at = range ? rangeBounds(range) : null;
  return (
    <>
      <PanelSection title={t("studio.graphics.kinds.table")}>
        <StatusLine id={element.id} />
        {editing ? (
          <p className="text-xs text-muted-foreground">{t("studio.graphics.editingHint")}</p>
        ) : (
          <button type="button" className={chip} onClick={() => openGraphic(element)} disabled={element.locked}>
            <Pencil className="size-4" aria-hidden />
            {t("studio.graphics.editCells")}
          </button>
        )}
        <div role="group" aria-label={t("studio.graphics.style")} className="flex flex-wrap gap-1.5">
          {TABLE_STYLE_IDS.map((id) => {
            const entry = TABLE_STYLES[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={look === id}
                onClick={() => set(entry)}
                className={cn("flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", look === id && "ring-2 ring-primary")}
              >
                <span className="paper-surface flex h-3.5 w-5 flex-col overflow-hidden rounded-sm border bg-white" style={{ borderColor: entry.borderColor }} aria-hidden>
                  <span className="h-1/2" style={{ backgroundColor: entry.headerFill ?? "transparent" }} />
                </span>
                {t(`studio.graphics.styles.${id}`)}
              </button>
            );
          })}
        </div>
        <Counter
          label={t("studio.graphics.rows")}
          icon={Rows3}
          value={rows}
          canAdd={rows < 60}
          canRemove={rows > 1}
          addLabel={t("studio.graphics.addRow")}
          removeLabel={t("studio.graphics.removeRow")}
          onAdd={() => updateTable(element.id, (current) => insertRow(current, at ? at.bottom + 1 : current.cells.length))}
          onRemove={() => updateTable(element.id, (current) => removeRow(current, at ? at.top : current.cells.length - 1))}
        />
        <Counter
          label={t("studio.graphics.columns")}
          icon={Columns3}
          value={columns}
          canAdd={columns < 20}
          canRemove={columns > 1}
          addLabel={t("studio.graphics.addColumn")}
          removeLabel={t("studio.graphics.removeColumn")}
          onAdd={() => updateTable(element.id, (current) => insertColumn(current, at ? at.right + 1 : columnCount(current)))}
          onRemove={() => updateTable(element.id, (current) => removeColumn(current, at ? at.left : columnCount(current) - 1))}
        />
        <SwitchField label={t("studio.graphics.headerRow")} checked={data.header} onChange={(header) => set({ header })} />
        <SwitchField label={t("studio.graphics.stripes")} checked={data.stripes} onChange={(stripes) => set({ stripes, stripeFill: data.stripeFill ?? DEFAULT_STRIPE })} />
        {data.stripes ? <ColorField label={t("studio.graphics.stripeColor")} value={data.stripeFill ?? DEFAULT_STRIPE} onChange={(stripeFill) => set({ stripeFill }, "table-stripe")} /> : null}
        <SwitchField label={t("studio.graphics.headerFill")} checked={data.headerFill !== null} onChange={(on) => set({ headerFill: on ? DEFAULT_HEADER_FILL : null })} />
        {data.headerFill ? <ColorField label={t("studio.graphics.headerFillColor")} value={data.headerFill} onChange={(headerFill) => set({ headerFill }, "table-header-fill")} /> : null}
      </PanelSection>
      {range ? <CellsSection element={element} data={data} range={range} /> : null}
      <PanelSection title={t("studio.graphics.tableText")}>
        <Labelled label={t("studio.graphics.font")}>
          <FontPicker value={data.fontId} onChange={(fontId) => set({ fontId })} />
        </Labelled>
        <NumberField label={t("studio.graphics.fontSize")} suffix="pt" value={Math.round(data.fontSize * 10) / 10} min={MIN_TABLE_FONT} max={MAX_TABLE_FONT} step={1} onChange={(fontSize) => set({ fontSize })} />
        <ColorField label={t("studio.graphics.textColor")} value={data.color} onChange={(color) => set({ color }, "table-color")} />
      </PanelSection>
      <PanelSection title={t("studio.graphics.borders")}>
        <Labelled label={t("studio.graphics.borderStyle")}>
          <Select size="sm" value={data.border} ariaLabel={t("studio.graphics.borderStyle")} options={TABLE_BORDERS.map((border) => ({ value: border, label: t(`studio.graphics.borderStyles.${border}`) }))} onChange={(border) => set({ border: border as StudioTableData["border"] })} />
        </Labelled>
        {data.border !== "none" ? (
          <>
            <ColorField label={t("studio.graphics.borderColor")} value={data.borderColor} onChange={(borderColor) => set({ borderColor }, "table-border-color")} />
            <SliderField label={t("studio.graphics.borderWidth")} value={data.borderWidth} min={0.25} max={6} step={0.25} format={(value) => `${value} pt`} onChange={(borderWidth) => set({ borderWidth }, "table-border-width")} />
          </>
        ) : null}
        <button type="button" className={chip} onClick={() => updateTable(element.id, distributeColumns)}>
          {t("studio.graphics.distribute")}
        </button>
      </PanelSection>
    </>
  );
}

function EditButton({ element, label }: { element: StudioSvgElement; label: string }) {
  return (
    <button type="button" className={chip} disabled={element.locked} onClick={() => openGraphic(element)}>
      <Pencil className="size-4" aria-hidden />
      {label}
    </button>
  );
}

function ChartSection({ element, data }: { element: StudioSvgElement; data: StudioChartData }) {
  const { t } = useTranslation();
  const settings = data.settings;
  const set = (patch: Partial<ChartSettings>, merge?: string) => patchGraphic(element.id, () => ({ data: { ...data, settings: { ...settings, ...patch } } }), merge);
  const round = settings.type === "pie" || settings.type === "doughnut";
  return (
    <PanelSection title={t("studio.graphics.kinds.chart")}>
      <StatusLine id={element.id} />
      <EditButton element={element} label={t("studio.graphics.editChart")} />
      <Labelled label={t("viewer.chart.type")}>
        <Select size="sm" value={settings.type} ariaLabel={t("viewer.chart.type")} options={CHART_TYPES.map((type) => ({ value: type, label: t(`viewer.chart.types.${type}`) }))} onChange={(type) => set({ type: type as ChartSettings["type"] })} />
      </Labelled>
      <Labelled label={t("viewer.chart.chartTitle")}>
        <TextInput value={settings.title} maxLength={300} aria-label={t("viewer.chart.chartTitle")} onChange={(event) => set({ title: event.target.value }, "chart-title")} className="h-8 text-sm" />
      </Labelled>
      {round ? null : (
        <>
          <Labelled label={t("viewer.chart.categoryTitle")}>
            <TextInput value={settings.categoryTitle} maxLength={200} aria-label={t("viewer.chart.categoryTitle")} onChange={(event) => set({ categoryTitle: event.target.value }, "chart-category")} className="h-8 text-sm" />
          </Labelled>
          <Labelled label={t("viewer.chart.valueTitle")}>
            <TextInput value={settings.valueTitle} maxLength={200} aria-label={t("viewer.chart.valueTitle")} onChange={(event) => set({ valueTitle: event.target.value }, "chart-value")} className="h-8 text-sm" />
          </Labelled>
        </>
      )}
      <SwitchField label={t("viewer.chart.legend")} checked={settings.legend} onChange={(legend) => set({ legend })} />
      {settings.legend ? (
        <Labelled label={t("viewer.chart.legendPosition")}>
          <Select size="sm" value={settings.legendPosition} ariaLabel={t("viewer.chart.legendPosition")} options={LEGEND_POSITIONS.map((position) => ({ value: position, label: t(`viewer.chart.legendPositions.${position}`) }))} onChange={(legendPosition) => set({ legendPosition: legendPosition as ChartSettings["legendPosition"] })} />
        </Labelled>
      ) : null}
      <SwitchField label={t("viewer.chart.valueLabels")} checked={settings.valueLabels} onChange={(valueLabels) => set({ valueLabels })} />
      {round ? null : <SwitchField label={t("viewer.chart.grid")} checked={settings.grid} onChange={(grid) => set({ grid })} />}
      <SliderField label={t("viewer.chart.fontSize")} value={Math.round(settings.fontSize)} min={4} max={36} format={(value) => `${value} pt`} onChange={(fontSize) => set({ fontSize }, "chart-font-size")} />
      <ColorField label={t("viewer.chart.textColor")} value={settings.color} onChange={(color) => set({ color }, "chart-color")} />
    </PanelSection>
  );
}

function FlowchartSection({ element, data }: { element: StudioSvgElement; data: StudioFlowchartData }) {
  const { t } = useTranslation();
  const settings = data.settings;
  const set = (patch: Partial<FlowchartSettings>, merge?: string) => patchGraphic(element.id, () => ({ data: { ...data, settings: { ...settings, ...patch } } }), merge);
  return (
    <PanelSection title={t("studio.graphics.kinds.flowchart")}>
      <StatusLine id={element.id} />
      <EditButton element={element} label={t("studio.graphics.editFlowchart")} />
      <div className="space-y-1">
        <span className="block text-xs font-medium text-muted-foreground">{t("viewer.flowchart.direction")}</span>
        <Segmented size="sm" value={settings.direction} options={FLOW_DIRECTIONS} labelOf={(direction) => t(`viewer.flowchart.directions.${direction}`)} onChange={(direction) => set({ direction })} ariaLabel={t("viewer.flowchart.direction")} />
      </div>
      <SliderField label={t("viewer.flowchart.fontSize")} value={Math.round(settings.fontSize)} min={4} max={36} format={(value) => `${value} pt`} onChange={(fontSize) => set({ fontSize }, "flow-font-size")} />
      <ColorField label={t("viewer.flowchart.textColor")} value={settings.color} onChange={(color) => set({ color }, "flow-color")} />
      <ColorField label={t("viewer.flowchart.lineColor")} value={settings.stroke} onChange={(stroke) => set({ stroke }, "flow-stroke")} />
      <SwitchField label={t("viewer.flowchart.fillShapes")} checked={settings.fill !== null} onChange={(on) => set({ fill: on ? "#eef2ff" : null })} />
      {settings.fill ? <ColorField label={t("viewer.flowchart.fillColor")} value={settings.fill} onChange={(fill) => set({ fill }, "flow-fill")} /> : null}
    </PanelSection>
  );
}

function FormulaSection({ element, data }: { element: StudioSvgElement; data: StudioFormulaData }) {
  const { t } = useTranslation();
  const setColor = (color: string) => {
    const formula = { ...data.formula, color };
    patchGraphic(element.id, () => ({ svg: formulaSvg(formula), data: { ...data, formula } }), "formula-color");
  };
  return (
    <PanelSection title={t("studio.graphics.kinds.formula")}>
      <EditButton element={element} label={t("studio.graphics.editFormula")} />
      <ColorField label={t("viewer.formula.color")} value={data.formula.color} onChange={setColor} />
    </PanelSection>
  );
}

export function GraphicSection({ element }: { element: StudioSvgElement }) {
  const graphic = graphicOf(element);
  if (!graphic) return null;
  switch (graphic.kind) {
    case "table":
      return <TableSection element={element} data={graphic.data} />;
    case "chart":
      return <ChartSection element={element} data={graphic.data} />;
    case "flowchart":
      return <FlowchartSection element={element} data={graphic.data} />;
    case "formula":
      return <FormulaSection element={element} data={graphic.data} />;
  }
}
