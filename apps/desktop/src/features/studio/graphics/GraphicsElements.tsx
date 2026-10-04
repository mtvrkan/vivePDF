import { useRef, useState, type KeyboardEvent } from "react";
import { ChartArea, ChartBar, ChartColumn, ChartLine, ChartPie, Donut, Sigma, Table2, Workflow, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { ChartType } from "@/types";
import type { StudioPage } from "@/types/studio";
import { insertTable, useGraphicEditor } from "./graphicEditor";

const PICKER_ROWS = 8;
const PICKER_COLUMNS = 8;

const CHARTS: { type: ChartType; icon: LucideIcon }[] = [
  { type: "column", icon: ChartColumn },
  { type: "bar", icon: ChartBar },
  { type: "line", icon: ChartLine },
  { type: "area", icon: ChartArea },
  { type: "pie", icon: ChartPie },
  { type: "doughnut", icon: Donut },
];

const tile = "card glass-tinted flex flex-col items-center gap-1.5 rounded-lg p-2 text-xs hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function TablePicker({ busy, onPick }: { busy: boolean; onPick: (rows: number, columns: number) => void }) {
  const { t } = useTranslation();
  const [size, setSize] = useState({ rows: 3, columns: 3 });
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focus = (rows: number, columns: number) => {
    const next = { rows: Math.min(PICKER_ROWS, Math.max(1, rows)), columns: Math.min(PICKER_COLUMNS, Math.max(1, columns)) };
    setSize(next);
    refs.current[(next.rows - 1) * PICKER_COLUMNS + next.columns - 1]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    focus(size.rows + move[0], size.columns + move[1]);
  };

  return (
    <div className="space-y-2">
      <div role="group" aria-label={t("studio.graphics.tablePicker")} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${PICKER_COLUMNS}, minmax(0, 1fr))` }}>
        {Array.from({ length: PICKER_ROWS * PICKER_COLUMNS }, (_, index) => {
          const rows = Math.floor(index / PICKER_COLUMNS) + 1;
          const columns = (index % PICKER_COLUMNS) + 1;
          const lit = rows <= size.rows && columns <= size.columns;
          const current = rows === size.rows && columns === size.columns;
          return (
            <button
              key={index}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              disabled={busy}
              tabIndex={current ? 0 : -1}
              data-table-size={`${rows}x${columns}`}
              aria-label={t("studio.graphics.tableSize", { rows, columns })}
              onMouseEnter={() => setSize({ rows, columns })}
              onFocus={() => setSize({ rows, columns })}
              onKeyDown={onKeyDown}
              onClick={() => onPick(rows, columns)}
              className={cn("aspect-square rounded-sm border transition-colors duration-(--transition-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", lit ? "border-primary bg-primary/25" : "border-border bg-background/60")}
            />
          );
        })}
      </div>
      <p className="text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
        {t("studio.graphics.tableSizeShort", { rows: size.rows, columns: size.columns })}
      </p>
    </div>
  );
}

export function GraphicsElements({ page }: { page: StudioPage }) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = useGraphicEditor((state) => state.open);

  const addTable = async (rows: number, columns: number) => {
    setBusy(true);
    try {
      await insertTable(page, rows, columns);
      setPicking(false);
    } catch (error) {
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2" aria-labelledby="studio-graphics-title">
      <h3 id="studio-graphics-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("studio.graphics.title")}
      </h3>
      <button type="button" aria-expanded={picking} onClick={() => setPicking((value) => !value)} className={cn(tile, "w-full flex-row justify-center gap-2 text-sm")} data-testid="studio-add-table">
        <Table2 className="size-5 text-primary" aria-hidden />
        {t("studio.graphics.addTable")}
      </button>
      {picking ? <TablePicker busy={busy} onPick={(rows, columns) => void addTable(rows, columns)} /> : null}
      <div className="grid grid-cols-3 gap-2">
        {CHARTS.map(({ type, icon: Icon }) => (
          <button key={type} type="button" data-chart-type={type} className={tile} onClick={() => open({ kind: "chart", elementId: null, chartType: type })}>
            <Icon className="size-5 text-primary" aria-hidden />
            {t(`viewer.chart.types.${type}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={cn(tile, "text-sm")} onClick={() => open({ kind: "flowchart", elementId: null })}>
          <Workflow className="size-5 text-primary" aria-hidden />
          {t("studio.graphics.kinds.flowchart")}
        </button>
        <button type="button" className={cn(tile, "text-sm")} onClick={() => open({ kind: "formula", elementId: null })}>
          <Sigma className="size-5 text-primary" aria-hidden />
          {t("studio.graphics.kinds.formula")}
        </button>
      </div>
    </section>
  );
}
