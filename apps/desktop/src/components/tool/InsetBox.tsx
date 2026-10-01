import { useId } from "react";
import { cn } from "@/shared/lib/cn";

const insetInputClass = "field h-8 w-16 rounded-md px-2 text-center font-mono text-sm disabled:opacity-50";

export type InsetSide = "top" | "right" | "bottom" | "left";
export type InsetValues = Record<InsetSide, number>;

function InsetInput({ side, value, max, onChange, label, unit, className }: {
  side: InsetSide;
  value: number;
  max?: number;
  onChange: (side: InsetSide, value: number) => void;
  label: string;
  unit: string;
  className?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      max={max}
      value={value}
      aria-invalid={!Number.isFinite(value) || value < 0 || (max !== undefined && value > max) || undefined}
      aria-label={`${label} (${unit})`}
      onChange={(event) => onChange(side, Number(event.target.value))}
      className={cn(insetInputClass, className)}
    />
  );
}

export function InsetBox({ values, max, onChange, sideLabel, unit }: {
  values: InsetValues;
  max?: number;
  onChange: (side: InsetSide, value: number) => void;
  sideLabel: (side: InsetSide) => string;
  unit: string;
}) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="flex justify-center">
      <span id={headingId} className="sr-only">{unit}</span>
      <div dir="ltr" className="grid w-fit grid-cols-[auto_9rem_auto] grid-rows-[auto_7rem_auto] items-center justify-items-center gap-2">
        <span />
        <InsetInput side="top" value={values.top} max={max} onChange={onChange} label={sideLabel("top")} unit={unit} />
        <span />
        <InsetInput side="left" value={values.left} max={max} onChange={onChange} label={sideLabel("left")} unit={unit} />
        <span aria-hidden className="flex size-full flex-col justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background/60 px-3">
          {["w-full", "w-10/12", "w-full", "w-8/12"].map((width, index) => (
            <span key={index} className={cn("block h-1 rounded-full bg-muted-foreground/25", width)} />
          ))}
        </span>
        <InsetInput side="right" value={values.right} max={max} onChange={onChange} label={sideLabel("right")} unit={unit} />
        <span />
        <InsetInput side="bottom" value={values.bottom} max={max} onChange={onChange} label={sideLabel("bottom")} unit={unit} />
        <span />
      </div>
    </div>
  );
}
