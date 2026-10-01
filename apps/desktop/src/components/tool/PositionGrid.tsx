import { useTranslation } from "react-i18next";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import { cn } from "@/shared/lib/cn";
import type { GridPosition, WatermarkPosition } from "@/types";

const GRID_POSITIONS: GridPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const MARK_WIDTH: Record<string, string> = {
  "top-left": "w-4",
  "top-center": "w-5",
  "top-right": "w-4",
  "middle-left": "w-4",
  center: "w-6",
  "middle-right": "w-4",
  "bottom-left": "w-4",
  "bottom-center": "w-5",
  "bottom-right": "w-4",
};

export function PositionGrid({ value, onChange, label, tile = false, disabled }: {
  value: WatermarkPosition;
  onChange: (value: WatermarkPosition) => void;
  label: string;
  tile?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const options: WatermarkPosition[] = tile ? [...GRID_POSITIONS, "tile"] : GRID_POSITIONS;
  const current = Math.max(0, options.indexOf(value));
  const roving = useRovingRadios(options, current, onChange, 3);

  return (
    <div role="radiogroup" aria-label={label} className={cn("w-40 space-y-2", disabled && "pointer-events-none opacity-50")}>
      <span className="flex items-baseline justify-between gap-2 text-sm font-medium text-foreground/80">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{t(`tools.mark.positions.${value}`)}</span>
      </span>
      <div dir="ltr" className="grid aspect-[1/1.24] grid-cols-3 grid-rows-3 gap-1 rounded-xl border border-border bg-background/60 p-1.5">
        {GRID_POSITIONS.map((option, index) => {
          const selected = option === value;
          return (
            <button
              key={option}
              ref={roving.refOf(index)}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={t(`tools.mark.positions.${option}`)}
              title={t(`tools.mark.positions.${option}`)}
              tabIndex={roving.tabIndexOf(index)}
              onKeyDown={roving.onKeyDown}
              onClick={() => onChange(option)}
              className={cn(
                "flex items-center justify-center rounded-md transition-[background-color,box-shadow] duration-(--transition-fast)",
                selected ? "option-selected" : "bg-secondary/60 hover:bg-secondary",
              )}
            >
              <span aria-hidden className={cn("h-1 rounded-full", MARK_WIDTH[option], selected ? "bg-(--tone)" : "bg-muted-foreground/45")} />
            </button>
          );
        })}
      </div>
      {tile ? (
        <button
          ref={roving.refOf(GRID_POSITIONS.length)}
          type="button"
          role="radio"
          aria-checked={value === "tile"}
          tabIndex={roving.tabIndexOf(GRID_POSITIONS.length)}
          onKeyDown={roving.onKeyDown}
          onClick={() => onChange("tile")}
          className={cn(
            "h-7 w-full rounded-md border text-xs font-medium transition-[background-color,box-shadow] duration-(--transition-fast)",
            value === "tile" ? "option-selected border-transparent text-(--tone)" : "border-border bg-secondary/60 text-muted-foreground hover:bg-secondary",
          )}
        >
          {t("tools.mark.positions.tile")}
        </button>
      ) : null}
    </div>
  );
}
