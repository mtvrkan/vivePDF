import { useState, type ReactNode } from "react";
import { ChevronDown, Eye, EyeOff, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import type { CvSectionKey } from "../cvModel";
import { useCvStore } from "../cvStore";

type FormSectionProps = {
  title: string;
  section?: CvSectionKey;
  count?: number;
  defaultOpen?: boolean;
  addLabel?: string;
  addDisabled?: boolean;
  onAdd?: () => void;
  children: ReactNode;
};

export function FormSection({ title, section, count, defaultOpen = false, addLabel, addDisabled, onAdd, children }: FormSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const hidden = useCvStore((state) => (section ? state.profile.hidden.includes(section) : false));
  const toggleHidden = () => {
    if (!section) return;
    useCvStore.getState().updateProfile((profile) => ({ ...profile, hidden: profile.hidden.includes(section) ? profile.hidden.filter((key) => key !== section) : [...profile.hidden, section] }));
  };
  const add = () => {
    setOpen(true);
    onAdd?.();
  };
  return (
    <section className="card glass-tinted rounded-xl" data-cv-section={section ?? "personal"}>
      <div className="flex items-center gap-1 pe-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3.5 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-(--transition-fast)", !open && "-rotate-90 rtl:rotate-90")} aria-hidden />
          <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", hidden && "text-muted-foreground line-through")}>{title}</span>
          {count !== undefined && count > 0 ? <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span> : null}
        </button>
        {onAdd && addLabel ? <IconButton icon={Plus} label={addLabel} disabled={addDisabled} onClick={add} /> : null}
        {section ? <IconButton icon={hidden ? EyeOff : Eye} label={hidden ? t("studio.cv.showSection", { name: title }) : t("studio.cv.hideSection", { name: title })} onClick={toggleHidden} /> : null}
      </div>
      {open ? <div className="space-y-3 border-t border-border/60 px-3.5 pb-3.5 pt-3">{children}</div> : null}
    </section>
  );
}
