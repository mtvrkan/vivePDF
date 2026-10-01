import { slotLabels } from "@/features/tools/edit/imposeOrder";
import { cn } from "@/shared/lib/cn";
import type { ImposeArrangement, ImposeReading } from "@/types";

const NUMBERED_LIMIT = 36;

export function ImposeOrderPreview({ columns, rows, arrangement, reading, label }: {
  columns: number;
  rows: number;
  arrangement: ImposeArrangement;
  reading: ImposeReading;
  label: string;
}) {
  const labels = slotLabels(columns, rows, arrangement, reading);
  const numbered = labels.length <= NUMBERED_LIMIT;

  return (
    <div
      role="img"
      aria-label={numbered ? `${label}: ${labels.join(", ")}` : `${label}: ${columns}×${rows}`}
      dir="ltr"
      className="grid w-full max-w-56 gap-1 rounded-xl border border-border bg-background/50 p-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
    >
      {labels.map((page, index) => (
        <span
          key={index}
          className={cn(
            "flex aspect-[1/1.2] items-center justify-center rounded-[3px] bg-secondary/70 font-mono text-foreground/70",
            numbered ? "text-[11px]" : "text-[0px]",
          )}
        >
          {numbered ? page : null}
        </span>
      ))}
    </div>
  );
}
