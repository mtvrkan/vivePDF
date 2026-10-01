import { useMemo, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Table2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, Segmented, SliderField, SwitchField } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { tablePreview } from "@/shared/rpc/operations";
import type { RpcError, TableAlign } from "@/types";
import { CellGrid } from "../grid/CellGrid";
import { EnginePreview } from "../grid/EnginePreview";
import { currentPreview, useEnginePreview } from "../grid/useEnginePreview";
import type { TableSource } from "./tableObject";
import { TABLE_ALIGNS, TABLE_BORDERS, TABLE_LIMITS, TABLE_STYLES, TABLE_WIDTH_MODES, applyStyle, applyTableEdit, isBlankTable, matchingStyle, setAlign, toTableSpec, type TableSettings } from "./tableModel";

const HEADER_FILL_FALLBACK = "#e5e7eb";
const ALIGN_ICONS: Record<TableAlign, LucideIcon> = { left: AlignLeft, center: AlignCenter, right: AlignRight };

export function TableDialog({ initial, updating, onClose, onSubmit }: { initial: TableSettings; updating: boolean; onClose: () => void; onSubmit: (source: TableSource) => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<TableSettings>(initial);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<RpcError | null>(null);
  const key = useMemo(() => JSON.stringify(toTableSpec(settings)), [settings]);
  const blank = isBlankTable(settings);
  const preview = useEnginePreview(tablePreview, key, !blank, attempt);
  const style = matchingStyle(settings);

  const update = (change: Partial<TableSettings>) => setSettings((current) => ({ ...current, ...change }));

  const submit = async () => {
    if (blank) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await currentPreview(preview, key, tablePreview);
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
      title={updating ? t("viewer.table.editTitle") : t("viewer.table.title")}
      onClose={onClose}
      footer={
        <>
          {submitError ? <span className="me-auto text-sm text-destructive">{describeError(t, submitError)}</span> : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={busy || blank}>
            {updating ? t("viewer.table.update") : t("viewer.table.insert")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="group" aria-label={t("viewer.table.style")} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground/80">{t("viewer.table.style")}</span>
          {TABLE_STYLES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={style === entry.id}
              onClick={() => setSettings((current) => applyStyle(current, entry))}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-[box-shadow] duration-(--transition-fast) hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                style === entry.id && "ring-2 ring-primary",
              )}
            >
              <span className="flex h-3.5 w-5 flex-col overflow-hidden rounded-sm border bg-white" style={{ borderColor: entry.borderColor }} aria-hidden>
                <span className="h-1/2" style={{ backgroundColor: entry.headerFill ?? "transparent" }} />
              </span>
              {t(`viewer.table.styles.${entry.id}`)}
            </button>
          ))}
        </div>
        <CellGrid
          legend={t("viewer.table.cells")}
          cells={settings.cells}
          limits={TABLE_LIMITS}
          onEdit={(edit) => setSettings((current) => applyTableEdit(current, edit))}
          headerRow={settings.header}
          columnTools={(column) =>
            TABLE_ALIGNS.map((align) => (
              <IconButton
                key={align}
                icon={ALIGN_ICONS[align]}
                label={t(`viewer.table.align.${align}`, { column: column + 1 })}
                active={settings.align[column] === align}
                aria-pressed={settings.align[column] === align}
                onClick={() => setSettings((current) => setAlign(current, column, align))}
              />
            ))
          }
        />
        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <EnginePreview state={preview} blank={blank} onRetry={() => setAttempt((value) => value + 1)} label={t("viewer.table.previewLabel")} emptyIcon={Table2} emptyTitle={t("viewer.table.emptyTitle")} emptyText={t("viewer.table.empty")} />
          </div>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto md:col-span-2">
            <SwitchField label={t("viewer.table.header")} checked={settings.header} onChange={(header) => update({ header })} />
            <SwitchField label={t("viewer.table.stripes")} checked={settings.stripes} onChange={(stripes) => update({ stripes })} />
            <Field label={t("viewer.table.border")}>
              <Select value={settings.border} options={TABLE_BORDERS.map((border) => ({ value: border, label: t(`viewer.table.borders.${border}`) }))} onChange={(border) => update({ border: border as TableSettings["border"] })} ariaLabel={t("viewer.table.border")} />
            </Field>
            <Field label={t("viewer.table.widthMode")}>
              <Segmented value={settings.widthMode} options={TABLE_WIDTH_MODES} labelOf={(mode) => t(`viewer.table.widthModes.${mode}`)} onChange={(widthMode) => update({ widthMode })} ariaLabel={t("viewer.table.widthMode")} size="sm" />
            </Field>
            <SliderField label={t("viewer.table.width")} value={settings.width} min={120} max={800} step={10} onChange={(width) => update({ width })} format={(value) => `${value} pt`} />
            <SliderField label={t("viewer.table.fontSize")} value={settings.fontSize} min={6} max={36} onChange={(fontSize) => update({ fontSize })} format={(value) => `${value} pt`} />
            <Field label={t("viewer.table.font")}>
              <FontPicker value={settings.fontId} onChange={(fontId) => update({ fontId })} />
            </Field>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.color} onChange={(color) => update({ color })} label={t("viewer.table.textColor")} customLabel={t("viewer.overlay.customColor")} />
                {t("viewer.table.textColor")}
              </span>
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.borderColor} onChange={(borderColor) => update({ borderColor })} label={t("viewer.table.borderColor")} customLabel={t("viewer.overlay.customColor")} disabled={settings.border === "none"} />
                {t("viewer.table.borderColor")}
              </span>
            </div>
            <SwitchField label={t("viewer.table.headerFill")} checked={settings.headerFill !== null} onChange={(on) => update({ headerFill: on ? HEADER_FILL_FALLBACK : null })} />
            {settings.headerFill !== null ? (
              <span className="flex items-center gap-2 text-sm">
                <ColorSwatch value={settings.headerFill} onChange={(headerFill) => update({ headerFill })} label={t("viewer.table.headerFillColor")} customLabel={t("viewer.overlay.customColor")} />
                {t("viewer.table.headerFillColor")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
