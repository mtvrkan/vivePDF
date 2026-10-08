import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Copy, GripVertical, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { canAdd, duplicateItem, moveItem, type ListKey } from "../cvEdits";
import { useCvStore } from "../cvStore";
import { useRemoveWithUndo } from "./useRemoveWithUndo";

type EntryCardProps = {
  listKey: ListKey;
  id: string;
  index: number;
  total: number;
  title: string;
  summary?: string;
  defaultOpen: boolean;
  dragging: boolean;
  target: boolean;
  onGrip: (event: ReactPointerEvent<HTMLElement>) => void;
  children: ReactNode;
};

export function EntryCard({ listKey, id, index, total, title, summary, defaultOpen, dragging, target, onGrip, children }: EntryCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const room = useCvStore((state) => canAdd(state.profile, listKey));
  const remove = useRemoveWithUndo(listKey);
  return (
    <div data-reorder-index={index} data-cv-entry={id} className={cn("rounded-lg border border-border/70", dragging && "opacity-60 ring-2 ring-primary", target && "border-primary")}>
      <div className="flex items-center gap-0.5 pe-1">
        <span aria-hidden title={t("studio.cv.drag", { name: title })} onPointerDown={onGrip} className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground" data-reorder-grip>
          <GripVertical className="size-4" />
        </span>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--transition-fast)", !open && "-rotate-90 rtl:rotate-90")} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{title}</span>
            {summary ? <span className="block truncate text-xs text-muted-foreground">{summary}</span> : null}
          </span>
        </button>
        <IconButton icon={ArrowUp} label={t("studio.cv.moveUp", { name: title })} disabled={index === 0} onClick={() => moveItem(listKey, index, index - 1)} />
        <IconButton icon={ArrowDown} label={t("studio.cv.moveDown", { name: title })} disabled={index === total - 1} onClick={() => moveItem(listKey, index, index + 1)} />
        <IconButton icon={Copy} label={t("studio.cv.duplicate", { name: title })} disabled={!room} onClick={() => duplicateItem(listKey, id)} />
        <IconButton icon={Trash2} label={t("studio.cv.remove", { name: title })} onClick={() => remove(id, title)} />
      </div>
      {open ? <div className="space-y-2.5 border-t border-border/60 p-3">{children}</div> : null}
    </div>
  );
}
