import { cn } from "@/shared/lib/cn";

export type FitMode = "fit" | "fill" | "stretch" | "box";

const CONTENT: Record<FitMode, string> = {
  fit: "inset-y-px start-[20%] w-[60%]",
  fill: "inset-y-px start-[-18%] w-[136%]",
  stretch: "inset-px",
  box: "start-[21%] top-[17%] h-[66%] w-[58%]",
};

export function FitPreview({ mode }: { mode: FitMode }) {
  return (
    <span className="relative block h-16 w-[3.25rem] rounded-sm border border-dashed border-foreground/35 bg-foreground/[0.04]">
      {mode === "fill" ? <span aria-hidden className={cn("absolute rounded-[2px] bg-current opacity-20", CONTENT.fill)} /> : null}
      <span aria-hidden className="absolute inset-0 overflow-hidden rounded-sm">
        <span className={cn("absolute rounded-[2px] bg-current opacity-55", CONTENT[mode])} />
      </span>
    </span>
  );
}
