import { useId } from "react";
import { cn } from "@/shared/lib/cn";
import { slotRows } from "./slotRows";

const slotInputClass = "field block w-full resize-none rounded-md px-2 py-1.5 text-sm leading-5 disabled:opacity-50";

export type SlotSide = "left" | "center" | "right";
export type SlotValues = Record<SlotSide, string>;

const SIDES: SlotSide[] = ["left", "center", "right"];
const BODY_LINES = ["w-full", "w-11/12", "w-full", "w-9/12"];

function SlotRow({ values, onChange, rowLabel, sideLabel, disabled }: {
  values: SlotValues;
  onChange: (side: SlotSide, value: string) => void;
  rowLabel: string;
  sideLabel: (side: SlotSide) => string;
  disabled?: boolean;
}) {
  return (
    <div dir="ltr" className="grid grid-cols-3 gap-2">
      {SIDES.map((side) => (
        <textarea
          key={side}
          dir="auto"
          rows={slotRows(values[side])}
          value={values[side]}
          disabled={disabled}
          aria-label={`${rowLabel} · ${sideLabel(side)}`}
          placeholder={sideLabel(side)}
          onChange={(event) => onChange(side, event.target.value)}
          className={cn(slotInputClass, side === "center" && "text-center", side === "right" && "text-right")}
        />
      ))}
    </div>
  );
}

export function PageSlots({ header, footer, onHeader, onFooter, headerLabel, footerLabel, sideLabel, disabled }: {
  header: SlotValues;
  footer: SlotValues;
  onHeader: (side: SlotSide, value: string) => void;
  onFooter: (side: SlotSide, value: string) => void;
  headerLabel: string;
  footerLabel: string;
  sideLabel: (side: SlotSide) => string;
  disabled?: boolean;
}) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className={cn("rounded-xl border border-border bg-background/40 p-3.5", disabled && "opacity-50")}>
      <p id={headingId} className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-foreground/70">{headerLabel}</p>
      <SlotRow values={header} onChange={onHeader} rowLabel={headerLabel} sideLabel={sideLabel} disabled={disabled} />
      <div aria-hidden className="my-5 space-y-2 px-3">
        {BODY_LINES.map((width, index) => (
          <span key={index} className={cn("block h-1 rounded-full bg-muted-foreground/20", width)} />
        ))}
      </div>
      <SlotRow values={footer} onChange={onFooter} rowLabel={footerLabel} sideLabel={sideLabel} disabled={disabled} />
      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-foreground/70">{footerLabel}</p>
    </div>
  );
}
