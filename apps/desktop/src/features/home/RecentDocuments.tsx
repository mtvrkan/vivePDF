import { useEffect, useRef, useState } from "react";
import { ArrowRight, Clock, FileText, FolderOpen, FolderSearch, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { bySize, type HomeSize } from "./homeLayout";
import { formatRelativeMoment } from "./homeSearch";
import { cn } from "@/shared/lib/cn";
import { RevealError, revealPath } from "@/shared/lib/reveal";
import { renderThumbnail, thumbnailDataUrl } from "@/shared/rpc/thumbnail";
import { useOpenStore } from "@/shared/store/openStore";
import { useRecentStore } from "@/shared/store/recentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { RecentFile } from "@/types";

const thumbnailCache = new Map<string, string>();

function RecentDocumentCard({ item, className }: { item: RecentFile; className?: string }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const { openPath } = useOpenPdf();
  const removeRecent = useRecentStore((state) => state.remove);
  const toast = useToastStore((state) => state.push);
  const ref = useRef<HTMLDivElement | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(thumbnailCache.get(item.path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (thumbnail || failed) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        renderThumbnail({ path: item.path, width: 320 })
          .then((result) => {
            const url = thumbnailDataUrl(result);
            thumbnailCache.set(item.path, url);
            setThumbnail(url);
          })
          .catch(() => setFailed(true));
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [item.path, thumbnail, failed]);

  const handleReveal = async () => {
    try {
      await revealPath(item.path);
    } catch (error) {
      const reasonKey = error instanceof RevealError ? error.reasonKey : "errors.revealFailed";
      toast("error", t(reasonKey));
    }
  };

  return (
    <div ref={ref} className={cn("group glass-flat relative flex flex-col overflow-hidden rounded-xl border border-(--glass-border)", className)}>
      <button type="button" onClick={() => void openPath(item.path)} title={item.path} aria-label={item.fileName} className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-secondary/40">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="size-full object-cover object-top" />
        ) : failed ? (
          <FileText className="size-9 text-muted-foreground" aria-hidden />
        ) : (
          <div className="size-full animate-pulse bg-secondary/70" />
        )}
        <ArrowRight className="absolute end-2 top-2 size-4 rounded-full bg-background/70 p-0.5 text-foreground opacity-0 transition-opacity duration-(--transition-fast) group-hover:opacity-100" aria-hidden />
      </button>
      <div className="flex items-center gap-1 p-2.5">
        <div className="min-w-0 flex-1">
          <p title={item.fileName} className="truncate text-sm font-medium">{item.fileName}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{formatRelativeMoment(item.openedAt, locale, Date.now(), t("home.justNow"))}</p>
        </div>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--transition-fast) focus-within:opacity-100 group-hover:opacity-100">
          <button type="button" onClick={() => void handleReveal()} aria-label={t("tools.reveal")} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <FolderSearch className="size-3.5" aria-hidden />
          </button>
          <button type="button" onClick={() => removeRecent(item.path)} aria-label={`${t("common.close")}: ${item.fileName}`} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

export function RecentDocuments({ size = "medium" }: { size?: HomeSize }) {
  const limit = bySize(size, 4, 6, 12);
  const { t } = useTranslation();
  const recent = useRecentStore((state) => state.items);
  const clearStore = useRecentStore((state) => state.clear);
  const restoreRecent = useRecentStore((state) => state.restore);
  const toast = useToastStore((state) => state.push);
  const { pickAndOpen } = useOpenPdf();
  const busy = useOpenStore((state) => state.busy);
  const [showAll, setShowAll] = useState(false);
  const clearRecent = () => {
    const snapshot = recent;
    clearStore();
    toast("info", t("home.recentCleared"), { label: t("common.undo"), onClick: () => restoreRecent(snapshot) });
  };
  const shown = showAll ? recent : recent.slice(0, limit);

  return (
    <section className="glass @container rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.recent")}</p>
        <div className="flex items-center gap-2">
          {recent.length > limit ? (
            <button type="button" onClick={() => setShowAll((value) => !value)} className="flex min-h-6 items-center rounded-full px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
              {showAll ? t("home.showLess") : `${t("home.showAll")} · ${recent.length}`}
            </button>
          ) : null}
          {recent.length > 0 ? (
            <button type="button" onClick={clearRecent} className="flex min-h-6 items-center rounded-full px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
              {t("home.clearRecent")}
            </button>
          ) : null}
        </div>
      </div>

      {recent.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <span className="tone-tile flex size-11 items-center justify-center rounded-2xl">
            <Clock className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium">{t("home.recentEmpty.title")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("home.recentEmpty.description")}</p>
          </div>
          <Button size="sm" icon={<FolderOpen className="size-4" aria-hidden />} loading={busy} onClick={() => void pickAndOpen()}>
            {t("common.openPdf")}
          </Button>
        </div>
      ) : (
        <div className={cn("mt-4 grid gap-3", size === "small" ? "grid-cols-2 @lg:grid-cols-4 @5xl:grid-cols-6" : "grid-cols-2 @md:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-6")}>
          {shown.map((item) => (
            <RecentDocumentCard key={item.path} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
