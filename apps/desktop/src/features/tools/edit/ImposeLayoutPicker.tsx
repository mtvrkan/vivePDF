import { useTranslation } from "react-i18next";
import { gridOf } from "@/features/tools/edit/imposeOrder";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import { cn } from "@/shared/lib/cn";
import type { ImposeLayout } from "@/types";

const LAYOUTS: ImposeLayout[] = ["2up", "3up", "4up", "6up", "8up", "9up", "12up", "16up", "booklet", "custom"];

function SheetShape({ columns, rows, spine }: { columns: number; rows: number; spine?: boolean }) {
  return (
    <span aria-hidden className="relative block h-9 w-[3.25rem] rounded-sm border border-border/80 p-[3px]">
      <span
        dir="ltr"
        className={cn("grid size-full", spine ? "gap-[7px]" : "gap-[2px]")}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns * rows }, (_, index) => (
          <span key={index} className="rounded-[1px] bg-current opacity-40" />
        ))}
      </span>
      {spine ? <span className="absolute inset-y-[3px] start-1/2 -translate-x-1/2 border-s border-dashed border-current opacity-80" /> : null}
    </span>
  );
}

function tileLabel(layout: ImposeLayout): string | null {
  return layout.endsWith("up") ? layout.slice(0, -2) : null;
}

export function ImposeLayoutPicker({ value, columns, rows, onChange, label }: {
  value: ImposeLayout;
  columns: number;
  rows: number;
  onChange: (value: ImposeLayout) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const current = Math.max(0, LAYOUTS.indexOf(value));
  const roving = useRovingRadios(LAYOUTS, current, onChange, 5);
  const [selectedColumns, selectedRows] = gridOf(value, columns, rows);

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-foreground/80">{label}</span>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-2">
        {LAYOUTS.map((layout, index) => {
          const [cells, lines] = gridOf(layout, columns, rows);
          const selected = layout === value;
          return (
            <button
              key={layout}
              ref={roving.refOf(index)}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={t(`tools.edit.impose.layouts.${layout}`)}
              tabIndex={roving.tabIndexOf(index)}
              onKeyDown={roving.onKeyDown}
              onClick={() => onChange(layout)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg px-1.5 py-2 transition-[background-color,box-shadow] duration-(--transition-fast)",
                selected ? "option-selected text-(--tone)" : "bg-secondary/50 text-muted-foreground/70 hover:bg-secondary",
              )}
            >
              <SheetShape columns={cells} rows={lines} spine={layout === "booklet"} />
              <span aria-hidden className={cn("text-[11px] leading-tight", selected ? "font-semibold text-(--tone)" : "text-foreground/70")}>
                {tileLabel(layout) ?? t(`tools.edit.impose.layouts.${layout}`)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {value === "booklet"
          ? t("tools.edit.impose.bookletHint")
          : t("tools.edit.impose.perSheet", { pages: selectedColumns * selectedRows, columns: selectedColumns, rows: selectedRows })}
      </p>
    </div>
  );
}
