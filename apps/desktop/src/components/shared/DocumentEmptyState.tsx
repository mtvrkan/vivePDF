import type { ReactNode } from "react";
import { ArrowRight, Clock, FileText, FolderOpen, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { usePaletteStore } from "@/shared/store/paletteStore";
import { useRecentStore } from "@/shared/store/recentStore";
import { useUiStore } from "@/shared/store/uiStore";
import { shortcutLabel } from "@/shared/lib/platform";

type Highlight = { icon: LucideIcon; label: string; onClick?: () => void };

type DocumentEmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  highlights: Highlight[];
  onOpen: () => void;
  onOpenPath: (path: string) => void;
  extra?: ReactNode;
};

const MAX_RECENT_SHOWN = 3;

export function DocumentEmptyState({ icon: Icon, title, description, highlights, onOpen, onOpenPath, extra }: DocumentEmptyStateProps) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const recent = useRecentStore((state) => state.items);
  const removeRecent = useRecentStore((state) => state.remove);
  const openPalette = usePaletteStore((state) => state.open);
  const shown = recent.slice(0, MAX_RECENT_SHOWN);

  return (
    <div className="flex h-full min-h-0 items-center overflow-auto px-6 py-8">
      <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="glass relative overflow-hidden rounded-3xl p-2">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full blur-3xl"
            style={{ background: "color-mix(in oklab, var(--tone) 26%, transparent)" }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -left-16 size-72 rounded-full blur-3xl"
            style={{ background: "color-mix(in oklab, var(--primary) 14%, transparent)" }}
          />
          <div
            className="relative flex h-full flex-col justify-between gap-8 rounded-[1.25rem] border border-dashed p-7"
            style={{ borderColor: "color-mix(in oklab, var(--tone) 38%, transparent)" }}
          >
            <div className="flex flex-col items-start gap-5">
              <span className="tone-tile flex size-14 items-center justify-center rounded-2xl">
                <Icon className="size-6" aria-hidden />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--tone)">{t("emptyDoc.eyebrow")}</p>
                <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{title}</h1>
                <p className="mt-2 max-w-md text-sm leading-5 text-muted-foreground">{description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" className="rounded-full" icon={<FolderOpen className="size-4" aria-hidden />} onClick={onOpen}>
                  {t("common.openPdf")}
                </Button>
                <span className="text-xs text-muted-foreground">{t("emptyDoc.dropHint")}</span>
                {extra}
              </div>
            </div>
            <ul className="flex flex-wrap gap-2">
              {highlights.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={item.onClick ?? onOpen}
                    className="glass-chip flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-start transition-[transform,box-shadow,background-color] duration-200 ease-(--ease-enter) hover:-translate-y-0.5 hover:bg-[color-mix(in_oklab,var(--tone)_7%,var(--card))] hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--tone)_24%,transparent),inset_0_1px_0_hsl(0_0%_100%/0.2),0_8px_20px_-14px_color-mix(in_oklab,var(--tone)_40%,transparent),var(--shadow-card)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg text-(--tone)" style={{ background: "color-mix(in oklab, var(--tone) 16%, transparent)" }}>
                      <item.icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="text-xs font-medium leading-4">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="glass flex min-h-0 flex-1 flex-col rounded-3xl p-3">
            <div className="flex h-9 items-center justify-between px-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.recent")}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{shown.length > 0 ? shown.length : ""}</span>
            </div>
            {shown.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-accent text-primary">
                  <Clock className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-medium">{t("home.recentEmpty.title")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("home.recentEmpty.description")}</p>
                </div>
              </div>
            ) : (
              <ul className="space-y-1">
                {shown.map((item) => (
                  <li key={item.path} className="nav-glass group flex items-center gap-1 rounded-xl px-2 py-1.5">
                    <button type="button" onClick={() => onOpenPath(item.path)} title={item.path} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                        <FileText className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span title={item.fileName} className="block truncate text-sm">{item.fileName}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {new Date(item.openedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--transition-fast) group-hover:opacity-100" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRecent(item.path)}
                      aria-label={`${t("common.close")}: ${item.fileName}`}
                      className="flex size-6 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="glass rounded-3xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("emptyDoc.shortcuts")}</p>
            <div className="mt-1.5 space-y-0.5 text-sm">
              <button type="button" onClick={onOpen} className="nav-glass -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-start text-muted-foreground hover:text-foreground">
                <span>{t("common.openPdf")}</span>
                <kbd className="glass-chip rounded-md px-1.5 py-0.5 font-mono text-[11px] text-foreground">{shortcutLabel("Ctrl O")}</kbd>
              </button>
              <button type="button" onClick={openPalette} className="nav-glass -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-start text-muted-foreground hover:text-foreground">
                <span>{t("emptyDoc.palette")}</span>
                <kbd className="glass-chip rounded-md px-1.5 py-0.5 font-mono text-[11px] text-foreground">{shortcutLabel("Ctrl K")}</kbd>
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
