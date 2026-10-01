import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";
import { wholeWithin, withinRange } from "@/shared/lib/numberRange";
import { useUiStore } from "@/shared/store/uiStore";
import type { PosterOrientation, PosterPaper } from "@/types";
import { POSTER_GRID, POSTER_MARGIN_MM, POSTER_OVERLAP_MM, posterGridOf, posterPlan, tileName, tileUsed, type PosterPlan, type PosterSettings } from "./posterPlan";

const PAPERS: PosterPaper[] = ["a4", "a3", "letter", "legal"];
const ORIENTATIONS: PosterOrientation[] = ["auto", "portrait", "landscape"];
const NAMED_LIMIT = 36;

function PosterPreview({ plan, columns, rows, label }: { plan: PosterPlan; columns: number; rows: number; label: string }) {
  const percent = (value: number, whole: number) => `${(value / whole) * 100}%`;
  const named = columns * rows <= NAMED_LIMIT;
  const tiles = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => ({ row, column }))).flat();
  return (
    <div role="img" aria-label={label} dir="ltr" className="w-full max-w-64">
      <div className="relative w-full rounded-md border border-border bg-background/50" style={{ aspectRatio: `${plan.total.width} / ${plan.total.height}` }}>
        <div
          className="absolute rounded-[2px] bg-primary/15 ring-1 ring-primary/50"
          style={{
            left: percent(plan.placed.x, plan.total.width),
            top: percent(plan.placed.y, plan.total.height),
            width: percent(plan.placed.width, plan.total.width),
            height: percent(plan.placed.height, plan.total.height),
          }}
        />
        {tiles.map(({ row, column }) => (
          <span
            key={`${row}-${column}`}
            className={cn(
              "absolute flex items-start justify-start border border-dashed p-0.5 font-mono text-[10px] leading-none text-foreground/70",
              tileUsed(plan, column, row) ? "border-foreground/30" : "border-foreground/10",
            )}
            style={{
              left: percent(column * plan.step.x, plan.total.width),
              top: percent(row * plan.step.y, plan.total.height),
              width: percent(plan.printable.width, plan.total.width),
              height: percent(plan.printable.height, plan.total.height),
            }}
          >
            {named && tileUsed(plan, column, row) ? tileName(column, row) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PosterTab({
  settings,
  onChange,
  pageSize,
  pageNumber,
}: {
  settings: PosterSettings;
  onChange: (patch: Partial<PosterSettings>) => void;
  pageSize: { width: number; height: number } | null;
  pageNumber: number;
}) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const grid = posterGridOf(settings);
  const plan = pageSize ? posterPlan(pageSize, grid) : null;

  return (
    <Section title={t("tools.edit.poster.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.edit.poster.hint")}</p>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tools.edit.poster.columns")}>
              <TextInput type="number" min={POSTER_GRID.min} max={POSTER_GRID.max} value={settings.columns} aria-invalid={!wholeWithin(settings.columns, POSTER_GRID) || undefined} onChange={(event) => onChange({ columns: Number(event.target.value) })} className="font-mono" />
            </Field>
            <Field label={t("tools.edit.poster.rows")}>
              <TextInput type="number" min={POSTER_GRID.min} max={POSTER_GRID.max} value={settings.rows} aria-invalid={!wholeWithin(settings.rows, POSTER_GRID) || undefined} onChange={(event) => onChange({ rows: Number(event.target.value) })} className="font-mono" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tools.pages.paperSize")}>
              <SelectInput value={settings.paper} aria-label={t("tools.pages.paperSize")} onChange={(event) => onChange({ paper: event.target.value as PosterPaper })}>
                {PAPERS.map((value) => (
                  <option key={value} value={value}>{t(`tools.edit.poster.papers.${value}`)}</option>
                ))}
              </SelectInput>
            </Field>
            <Field label={t("tools.edit.impose.orientation")}>
              <SelectInput value={settings.orientation} aria-label={t("tools.edit.impose.orientation")} onChange={(event) => onChange({ orientation: event.target.value as PosterOrientation })}>
                {ORIENTATIONS.map((value) => (
                  <option key={value} value={value}>{t(`tools.edit.impose.orientations.${value}`)}</option>
                ))}
              </SelectInput>
            </Field>
          </div>
        </div>
        {plan ? (
          <div className="space-y-1">
            <PosterPreview plan={plan} columns={grid.columns} rows={grid.rows} label={t("tools.edit.poster.previewLabel", { columns: grid.columns, rows: grid.rows })} />
            <p className="text-xs text-muted-foreground">{t("tools.edit.poster.previewPage", { page: formatNumber(pageNumber, locale) })}</p>
          </div>
        ) : null}
      </div>
      {plan ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("tools.edit.poster.summary", {
            sheets: formatNumber(plan.sheets, locale),
            width: formatNumber(Math.round(plan.widthMm / 10), locale),
            height: formatNumber(Math.round(plan.heightMm / 10), locale),
            scale: formatNumber(Math.round(plan.scale * 100), locale),
          })}
        </p>
      ) : null}
      {plan?.thin ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground/80">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t("tools.edit.poster.thinSheets")}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("tools.edit.poster.margin")} hint={t("tools.edit.poster.marginHint")}>
          <TextInput type="number" min={POSTER_MARGIN_MM.min} max={POSTER_MARGIN_MM.max} step={0.5} value={settings.marginMm} aria-invalid={!withinRange(settings.marginMm, POSTER_MARGIN_MM) || undefined} onChange={(event) => onChange({ marginMm: Number(event.target.value) })} className="font-mono" />
        </Field>
        <Field label={t("tools.edit.poster.overlap")} hint={t("tools.edit.poster.overlapHint")}>
          <TextInput type="number" min={POSTER_OVERLAP_MM.min} max={POSTER_OVERLAP_MM.max} step={0.5} value={settings.overlapMm} aria-invalid={!withinRange(settings.overlapMm, POSTER_OVERLAP_MM) || undefined} onChange={(event) => onChange({ overlapMm: Number(event.target.value) })} className="font-mono" />
        </Field>
        <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
          <TextInput value={settings.pages} onChange={(event) => onChange({ pages: event.target.value })} placeholder={t("tools.allPages")} className="font-mono" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchField label={t("tools.edit.poster.cutMarks")} hint={t("tools.edit.poster.cutMarksHint")} checked={settings.cutMarks} onChange={(cutMarks) => onChange({ cutMarks })} />
        <SwitchField label={t("tools.edit.poster.labels")} hint={t("tools.edit.poster.labelsHint")} checked={settings.labels} onChange={(labels) => onChange({ labels })} />
      </div>
    </Section>
  );
}
