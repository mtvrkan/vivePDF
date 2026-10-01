import { cn } from "@/shared/lib/cn";
import type { ChangeMark } from "@/types";

const TEXT_TONE = {
  a: "bg-destructive/20 ring-1 ring-destructive/60",
  b: "bg-success/20 ring-1 ring-success/60",
} as const;

export function ChangeMarks({ marks, side, width, height }: { marks: ChangeMark[] | undefined; side: "a" | "b"; width: number; height: number }) {
  if (!marks || marks.length === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {marks.map((mark, index) => {
        const [x0, y0, x1, y1] = mark.box;
        return (
          <span
            key={index}
            className={cn("absolute rounded-sm", mark.kind === "text" ? TEXT_TONE[side] : "ring-2 ring-warning/70")}
            style={{ left: x0 * width, top: y0 * height, width: Math.max(2, (x1 - x0) * width), height: Math.max(2, (y1 - y0) * height) }}
          />
        );
      })}
    </div>
  );
}
