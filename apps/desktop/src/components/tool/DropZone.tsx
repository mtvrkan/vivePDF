import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";

export function DropZone({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const dragging = useDropTargetStore((state) => state.dragging);
  return (
    <div className={cn("relative rounded-xl transition-[box-shadow,background-color] duration-(--transition-fast)", dragging && "bg-primary/5 ring-2 ring-primary/70", className)}>
      {children}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/55 backdrop-blur-[2px]">
          <span className="glass-chip rounded-full px-3.5 py-1.5 text-xs font-semibold text-primary shadow-(--shadow-float)">{label}</span>
        </div>
      ) : null}
    </div>
  );
}
