import { FolderOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";

type FileDropAreaProps = {
  title: string;
  description: string;
  onPick: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  className?: string;
};

export function FileDropArea({ title, description, onPick, icon: Icon = FolderOpen, disabled, className }: FileDropAreaProps) {
  const dragging = useDropTargetStore((state) => state.dragging);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground outline-none transition-colors duration-(--transition-fast) hover:border-primary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
        dragging && "border-primary bg-primary/5",
        className,
      )}
    >
      <Icon className="size-6" aria-hidden />
      <span className="font-medium text-foreground">{title}</span>
      <span>{description}</span>
    </button>
  );
}
