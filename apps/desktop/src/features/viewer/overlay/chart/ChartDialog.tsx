import { useMemo, useState } from "react";
import { ChartArea, ChartBar, ChartCandlestick, ChartColumn, ChartColumnBig, ChartLine, ChartPie, ChartScatter, Donut, Grip, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch, type ColorSwatchRow } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { FontPicker } from "@/components/shared/FontPicker";
import { Select } from "@/components/shared/Select";
import { Field, SliderField, SwitchField, TextInput } from "@/components/tool/form";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { chartPreview } from "@/shared/rpc/operations";
import type { ChartType, RpcError } from "@/types";
import { CellGrid } from "../grid/CellGrid";
import { EnginePreview } from "../grid/EnginePreview";
import { currentPreview, useEnginePreview } from "../grid/useEnginePreview";
import type { ChartSource } from "./chartObject";
import { CHART_BINS, CHART_LIMITS, CHART_PALETTES, CHART_PALETTE_IDS, CHART_TYPES, LEGEND_POSITIONS, ROUND_TYPES, SAMPLE_TYPES, STACKABLE_TYPES, applyChartEdit, applyPalette, cellKey, chartData, setSeriesColor, type ChartPaletteId, type ChartSettings } from "./chartModel";

const TYPE_ICONS: Record<ChartType, LucideIcon> = { column: ChartColumn, bar: ChartBar, line: ChartLine, area: ChartArea, pie: ChartPie, doughnut: Donut, scatter: ChartScatter, histogram: ChartColumnBig, box: ChartCandlestick, dotplot: Grip };

function TypePicker({ value, onChange }: { value: ChartType; onChange: (type: ChartType) => void }) {
  const { t } = useTranslation();
  const roving = useRovingRadios(CHART_TYPES, Math.max(0, CHART_TYPES.indexOf(value)), onChange);
  return (
    <div role="radiogroup" aria-label={t("viewer.chart.type")} className="grid grid-cols-2 gap-2 p-0.5 sm:grid-cols-5">
      {CHART_TYPES.map((type, index) => {
        const Icon = TYPE_ICONS[type];
        const selected = type === value;
        return (
          <button
            key={type}
            ref={roving.refOf(index)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={roving.tabIndexOf(index)}
            onKeyDown={roving.onKeyDown}
            onClick={() => onChange(type)}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-start text-sm transition-[box-shadow] duration-(--transition-fast) hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "font-medium text-foreground ring-2 ring-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t(`viewer.chart.types.${type}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

type ChartDialogProps = { initial: ChartSettings; updating: boolean; onClose: () => void; onSubmit: (source: ChartSource) => void; swatchRows?: () => ColorSwatchRow[]; fixedSize?: boolean };

export function ChartDialog({ initial, updating, onClose, onSubmit, swatchRows, fixedSize = false }: ChartDialogProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ChartSettings>(initial);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<RpcError | null>(null);
  const data = useMemo(() => chartData(settings), [settings]);
  const key = useMemo(() => JSON.stringify(data.spec), [data]);
  const preview = useEnginePreview(chartPreview, key, !data.blank, attempt);
  const round = ROUND_TYPES.includes(settings.type);

  const update = (change: Partial<ChartSettings>) => setSettings((current) => ({ ...current, ...change }));

  const submit = async () => {
    if (data.blank) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await currentPreview(preview, key, chartPreview);
      onSubmit({ settings, svg: result.svg, width: result.width, height: result.height });
    } catch (error) {
      setSubmitError(toRpcError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="xl"
      title={updating ? t("viewer.chart.editTitle") : t("viewer.chart.title")}
      onClose={onClose}
      footer={
        <>
          {submitError ? <span className="me-auto text-sm text-destructive">{describeError(t, submitError)}</span> : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={busy || data.blank}>
            {updating ? t("viewer.chart.update") : t("viewer.chart.insert")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TypePicker value={settings.type} onChange={(type) => update({ type })} />
        <CellGrid
          legend={t("viewer.chart.data")}
          cells={settings.cells}
          limits={CHART_LIMITS}
          onEdit={(edit) => setSettings((current) => applyChartEdit(current, edit))}
          headerRow
          headerColumn
          fixedColumns={1}
          narrow
          hint={t(SAMPLE_TYPES.includes(settings.type) ? "viewer.chart.dataHintSamples" : "viewer.chart.dataHint")}
          invalid={(row, column) => data.invalid.has(cellKey(row, column))}
          columnTools={(column) =>
            column === 0 ? null : (
              <ColorSwatch
                value={settings.colors[column - 1] ?? CHART_PALETTES[settings.palette][0]}
                onChange={(color) => setSettings((current) => setSeriesColor(current, column - 1, color))}
                label={t("viewer.chart.seriesColor", { number: column })}
                customLabel={t("viewer.overlay.customColor")}
                rows={swatchRows}
              />
            )
          }
        />
        {data.invalid.size > 0 ? <p className="-mt-2 text-xs text-destructive">{t(settings.type === "scatter" ? "viewer.chart.invalidScatter" : "viewer.chart.invalidCells")}</p> : null}
        {round && data.spec.series.length > 1 ? <p className="-mt-2 text-xs text-muted-foreground">{t("viewer.chart.pieFirstSeries")}</p> : null}
        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <EnginePreview state={preview} blank={data.blank} onRetry={() => setAttempt((value) => value + 1)} label={t("viewer.chart.previewLabel")} emptyIcon={ChartColumn} emptyTitle={t("viewer.chart.emptyTitle")} emptyText={t("viewer.chart.empty")} />
          </div>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto md:col-span-2">
            <Field label={t("viewer.chart.chartTitle")}>
              <TextInput value={settings.title} maxLength={300} onChange={(event) => update({ title: event.target.value })} />
            </Field>
            {round ? null : (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("viewer.chart.categoryTitle")}>
                  <TextInput value={settings.categoryTitle} maxLength={200} onChange={(event) => update({ categoryTitle: event.target.value })} />
                </Field>
                <Field label={t("viewer.chart.valueTitle")}>
                  <TextInput value={settings.valueTitle} maxLength={200} onChange={(event) => update({ valueTitle: event.target.value })} />
                </Field>
              </div>
            )}
            <SwitchField label={t("viewer.chart.legend")} checked={settings.legend} onChange={(legend) => update({ legend })} />
            {settings.legend ? (
              <Field label={t("viewer.chart.legendPosition")}>
                <Select value={settings.legendPosition ?? "bottom"} options={LEGEND_POSITIONS.map((position) => ({ value: position, label: t(`viewer.chart.legendPositions.${position}`) }))} onChange={(legendPosition) => update({ legendPosition: legendPosition as ChartSettings["legendPosition"] })} ariaLabel={t("viewer.chart.legendPosition")} />
              </Field>
            ) : null}
            <SwitchField label={t("viewer.chart.valueLabels")} checked={settings.valueLabels} onChange={(valueLabels) => update({ valueLabels })} />
            {round ? null : <SwitchField label={t("viewer.chart.grid")} checked={settings.grid} onChange={(grid) => update({ grid })} />}
            {STACKABLE_TYPES.includes(settings.type) ? <SwitchField label={t("viewer.chart.stacked")} checked={settings.stacked} onChange={(stacked) => update({ stacked })} /> : null}
            {settings.type === "histogram" ? (
              <SliderField label={t("viewer.chart.bins")} value={settings.bins} min={CHART_BINS.auto} max={CHART_BINS.max} onChange={(bins) => update({ bins })} format={(value) => (value === CHART_BINS.auto ? t("viewer.chart.binsAuto") : String(value))} />
            ) : null}
            <Field label={t("viewer.chart.palette")}>
              <Select value={settings.palette} options={CHART_PALETTE_IDS.map((id) => ({ value: id, label: t(`viewer.chart.palettes.${id}`) }))} onChange={(palette) => setSettings((current) => applyPalette(current, palette as ChartPaletteId))} ariaLabel={t("viewer.chart.palette")} />
            </Field>
            {fixedSize ? null : (
              <>
                <SliderField label={t("viewer.chart.width")} value={settings.width} min={160} max={800} step={10} onChange={(width) => update({ width })} format={(value) => `${value} pt`} />
                <SliderField label={t("viewer.chart.height")} value={settings.height} min={120} max={600} step={10} onChange={(height) => update({ height })} format={(value) => `${value} pt`} />
              </>
            )}
            <SliderField label={t("viewer.chart.fontSize")} value={settings.fontSize} min={6} max={24} onChange={(fontSize) => update({ fontSize })} format={(value) => `${value} pt`} />
            <Field label={t("viewer.chart.font")}>
              <FontPicker value={settings.fontId} onChange={(fontId) => update({ fontId })} />
            </Field>
            <span className="flex items-center gap-2 text-sm">
              <ColorSwatch value={settings.color} onChange={(color) => update({ color })} label={t("viewer.chart.textColor")} customLabel={t("viewer.overlay.customColor")} rows={swatchRows} />
              {t("viewer.chart.textColor")}
            </span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
