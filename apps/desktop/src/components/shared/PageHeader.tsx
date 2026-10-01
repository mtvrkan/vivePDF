import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Tone } from "@/types";

type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  actions?: ReactNode;
};

export function PageHeader({ title, description, eyebrow, icon: Icon, tone, actions }: PageHeaderProps) {
  return (
    <header data-tone={tone} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 glass-flat border-b px-4 py-4 md:px-6">
      <div className="flex min-w-0 items-center gap-4">
        {Icon ? (
          <span aria-hidden className="tone-tile flex size-11 shrink-0 items-center justify-center rounded-xl">
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--tone)">{eyebrow}</p> : null}
          <h1 className="truncate text-xl font-semibold leading-7 tracking-tight">{title}</h1>
          {description ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
