import { IdCard, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "@/components/shared/Button";
import { useRecentDesignsStore, type StudioRouteState } from "@/features/studio/design/recentDesigns";
import { cn } from "@/shared/lib/cn";
import { useUiStore } from "@/shared/store/uiStore";
import { bySize, type HomeSize } from "./homeLayout";
import { formatRelativeMoment } from "./homeSearch";

export function StudioSection({ size = "medium" }: { size?: HomeSize }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useUiStore((state) => state.locale);
  const designs = useRecentDesignsStore((state) => state.items);
  const shown = designs.slice(0, bySize(size, 3, 4, 8));
  const open = (path: string) => void navigate("/studio", { state: { designPath: path } satisfies StudioRouteState });

  return (
    <section className="glass @container rounded-2xl p-5" data-testid="home-studio">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.studio.title")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Palette className="size-4" aria-hidden />} onClick={() => void navigate("/studio")}>
            {t("home.studio.open")}
          </Button>
          <Button size="sm" icon={<IdCard className="size-4" aria-hidden />} onClick={() => void navigate("/studio?cv=1")}>
            {t("studio.cv.start")}
          </Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("home.studio.empty")}</p>
      ) : (
        <ul className={cn("mt-4 grid gap-3", size === "small" ? "grid-cols-3 @2xl:grid-cols-6" : "grid-cols-2 @md:grid-cols-3 @3xl:grid-cols-4")}>
          {shown.map((item) => (
            <li key={item.path}>
              <button
                type="button"
                onClick={() => open(item.path)}
                title={item.path}
                data-home-design={item.name}
                className="glass-flat group flex w-full flex-col overflow-hidden rounded-xl border border-(--glass-border) text-start outline-none hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-secondary/40 p-2" aria-hidden>
                  {item.thumbnail ? <img src={item.thumbnail} alt="" width={item.width} height={item.height} className="max-h-full w-auto max-w-full rounded-sm object-contain shadow-sm" /> : <Palette className="size-8 text-muted-foreground" />}
                </span>
                <span className="block p-2.5">
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{formatRelativeMoment(item.savedAt, locale, Date.now(), t("home.justNow"))}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
