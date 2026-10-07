import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Clock, FileText, FolderOpen, FolderSearch, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { bySize, emptyPadding, sectionPadding, type HomeSize } from "./homeLayout";
import { formatRelativeMoment } from "./homeSearch";
import { useMissingPaths } from "./useMissingPaths";
import { cn } from "@/shared/lib/cn";
import { RevealError, revealPath } from "@/shared/lib/reveal";
import { renderThumbnail, thumbnailDataUrl } from "@/shared/rpc/thumbnail";
import { useOpenStore } from "@/shared/store/openStore";
import { useRecentStore } from "@/shared/store/recentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { RecentFile } from "@/types";

const THUMBNAIL_CACHE_LIMIT = 40;
const thumbnailCache = new Map<string, string>();

function readThumbnail(path: string): string | null {
  const url = thumbnailCache.get(path);
  if (url === undefined) return null;
  thumbnailCache.delete(path);
  thumbnailCache.set(path, url);
  return url;
}

function storeThumbnail(path: string, url: string) {
  thumbnailCache.delete(path);
  thumbnailCache.set(path, url);
  while (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
    const oldest = thumbnailCache.keys().next().value;
    if (oldest === undefined) break;
    thumbnailCache.delete(oldest);
  }
}

function RecentDocumentCard({ item, isMissing, className }: { item: RecentFile; isMissing: boolean; className?: string }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const { openPath } = useOpenPdf();
  const removeRecent = useRecentStore((state) => state.remove);
  const toast = useToastStore((state) => state.push);
  const ref = useRef<HTMLDivElement | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(() => readThumbnail(item.path));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (thumbnail || failed || isMissing) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        renderThumbnail({ path: item.path, width: 320 })
          .then((result) => {
            const url = thumbnailDataUrl(result);
            storeThumbnail(item.path, url);
            setThumbnail(url);
          })
          .catch(() => setFailed(true));
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [item.path, thumbnail, failed, isMissing]);

  const handleReveal = async () => {
    try {
      await revealPath(item.path);
    } catch (error) {
      const reasonKey = error instanceof RevealError ? error.reasonKey : "errors.revealFailed";
      toast("error", t(reasonKey));
    }
  };

  return (
    <div ref={ref} className={cn("group glass-flat relative flex flex-col overflow-hidden rounded-xl border border-(--glass-border)", isMissing && "opacity-60", className)}>
      <button type="button" disabled={isMissing} onClick={() => void openPath(item.path)} title={isMissing ? t("home.collections.missing") : item.path} aria-label={item.fileName} className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-secondary/40 disabled:cursor-not-allowed">
        {isMissing ? (
          <AlertTriangle className="size-9 text-warning" aria-hidden />
        ) : thumbnail ? (
          <img src={thumbnail} alt="" className="size-full object-cover object-top" />
        ) : failed ? (
          <FileText className="size-9 text-muted-foreground" aria-hidden />
        ) : (
          <div className="size-full animate-pulse bg-secondary/70" />
        )}
        {isMissing ? null : <ArrowRight className="absolute end-2 top-2 size-4 rounded-full bg-background/70 p-0.5 text-foreground opacity-0 transition-opacity duration-(--transition-fast) group-hover:opacity-100" aria-hidden />}
      </button>
      <div className="flex items-center gap-1 p-2.5">
        <div className="min-w-0 flex-1">
          <p title={item.fileName} className="truncate text-sm font-medium">{item.fileName}</p>
          <p className={cn("mt-0.5 truncate text-[11px]", isMissing ? "text-warning" : "font-mono text-muted-foreground")}>{isMissing ? t("home.collections.missing") : formatRelativeMoment(item.openedAt, locale, Date.now(), t("home.justNow"))}</p>
        </div>
        <div className={cn("flex shrink-0 items-center transition-opacity duration-(--transition-fast) focus-within:opacity-100 group-hover:opacity-100", isMissing ? "opacity-100" : "opacity-0")}>
          {isMissing ? null : (
            <button type="button" onClick={() => void handleReveal()} aria-label={t("tools.reveal")} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <FolderSearch className="size-3.5" aria-hidden />
            </button>
          )}
          <button type="button" onClick={() => removeRecent(item.path)} aria-label={t("home.removeRecent", { name: item.fileName })} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

function RecentDocumentRow({ item, isMissing }: { item: RecentFile; isMissing: boolean }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const { openPath } = useOpenPdf();
  const removeRecent = useRecentStore((state) => state.remove);

  return (
    <li className={cn("nav-glass group flex items-center gap-1 rounded-lg pe-1", isMissing && "opacity-60")}>
      <button type="button" disabled={isMissing} onClick={() => void openPath(item.path)} title={isMissing ? t("home.collections.missing") : item.path} aria-label={item.fileName} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed">
        {isMissing ? <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden /> : <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-sm">{item.fileName}</span>
        <span className={cn("shrink-0 text-[11px]", isMissing ? "text-warning" : "font-mono text-muted-foreground")}>{isMissing ? t("home.collections.missing") : formatRelativeMoment(item.openedAt, locale, Date.now(), t("home.justNow"))}</span>
      </button>
      <button type="button" onClick={() => removeRecent(item.path)} aria-label={t("home.removeRecent", { name: item.fileName })} className={cn("rounded-full p-1.5 text-muted-foreground transition-opacity duration-(--transition-fast) hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100", isMissing ? "opacity-100" : "opacity-0")}>
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
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
  const missing = useMissingPaths(useMemo(() => shown.map((item) => item.path), [shown]));

  return (
    <section className={cn("glass @container rounded-2xl", sectionPadding(size))}>
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
        <div className={cn("flex flex-col items-center gap-3 px-4 text-center", emptyPadding(size))}>
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
        size === "small" ? (
          <ul className="mt-3 grid gap-x-3 gap-y-0.5 @2xl:grid-cols-2">
            {shown.map((item) => (
              <RecentDocumentRow key={item.path} item={item} isMissing={missing.has(item.path)} />
            ))}
          </ul>
        ) : (
        <div className={cn("mt-4 grid gap-3", size === "large" ? "grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3" : "grid-cols-2 @md:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-6")}>
          {shown.map((item) => (
            <RecentDocumentCard key={item.path} item={item} isMissing={missing.has(item.path)} />
          ))}
        </div>
        )
      )}
    </section>
  );
}
